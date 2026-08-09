"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import Swal from "sweetalert2";

import { supabase } from "@/lib/supabase";

function money(value) {
  return Number(value || 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function quantity(value) {
  return Number(value || 0).toLocaleString("es-MX", {
    maximumFractionDigits: 2,
  });
}

function getRelatedObject(value) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

async function getPageData() {
  const [recipesResult, categoriesResult, subrecipesResult] = await Promise.all(
    [
      // RECETAS
      supabase
        .from("recipes")
        .select(
          `
        id,
        name,
        category_id,

        yield_quantity,
        yield_unit,

        cost_percentage,
        waste_percentage,

        electric_time_minutes,
        gas_time_minutes,

        created_at,

        categories (
          id,
          name
        ),

        recipe_ingredients (
          id
        )
      `,
        )
        .order("created_at", {
          ascending: false,
        }),

      // CATEGORÍAS
      supabase.from("categories").select("id, name").order("name", {
        ascending: true,
      }),

      // SUBRECETAS, SIN HACER EMBED
      supabase.from("recipe_subrecipes").select(`
        id,
        recipe_id,
        subrecipe_id
      `),
    ],
  );

  // ---------------------------------------------
  // ERRORES MOSTRADOS CORRECTAMENTE
  // ---------------------------------------------

  if (recipesResult.error) {
    const error = recipesResult.error;

    console.error("ERROR RECETAS:");
    console.error("message:", error.message);
    console.error("code:", error.code);
    console.error("details:", error.details);
    console.error("hint:", error.hint);

    throw new Error(error.message || "Error desconocido al cargar recetas.");
  }

  if (categoriesResult.error) {
    const error = categoriesResult.error;

    console.error("ERROR CATEGORÍAS:");
    console.error("message:", error.message);
    console.error("code:", error.code);
    console.error("details:", error.details);
    console.error("hint:", error.hint);

    throw new Error(error.message || "Error desconocido al cargar categorías.");
  }

  if (subrecipesResult.error) {
    const error = subrecipesResult.error;

    console.error("ERROR SUBRECETAS:");
    console.error("message:", error.message);
    console.error("code:", error.code);
    console.error("details:", error.details);
    console.error("hint:", error.hint);

    throw new Error(error.message || "Error desconocido al cargar subrecetas.");
  }

  // ---------------------------------------------
  // CONTAR CUÁNTAS SUBRECETAS USA CADA RECETA
  // ---------------------------------------------

  const subrecipeCountMap = {};

  for (const relation of subrecipesResult.data ?? []) {
    const parentRecipeId = relation.recipe_id;

    subrecipeCountMap[parentRecipeId] =
      (subrecipeCountMap[parentRecipeId] ?? 0) + 1;
  }

  // ---------------------------------------------
  // OBTENER EL COSTEO DE CADA RECETA
  // ---------------------------------------------

  const recipes = await Promise.all(
    (recipesResult.data ?? []).map(async (recipe) => {
      const { data, error } = await supabase.rpc("get_recipe_cost_breakdown", {
        p_recipe_id: recipe.id,
      });

      if (error) {
        console.error(`ERROR CALCULANDO "${recipe.name}":`);

        console.error("message:", error.message);
        console.error("code:", error.code);
        console.error("details:", error.details);
        console.error("hint:", error.hint);

        throw new Error(
          error.message || `No se pudo calcular la receta ${recipe.name}.`,
        );
      }

      return {
        ...recipe,

        // Número de recetas que esta receta utiliza como ingrediente
        subrecipe_count: subrecipeCountMap[recipe.id] ?? 0,

        breakdown: data ?? {},
      };
    }),
  );

  return {
    recipes,

    categories: categoriesResult.data ?? [],
  };
}
export default function RecetasPage() {
  const [recipes, setRecipes] = useState([]);

  const [categories, setCategories] = useState([]);

  const [loading, setLoading] = useState(true);

  const [deletingId, setDeletingId] = useState(null);

  const [search, setSearch] = useState("");

  const [categoryFilter, setCategoryFilter] = useState("all");

  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        const data = await getPageData();

        if (!active) return;

        setRecipes(data.recipes);
        setCategories(data.categories);
      } catch (error) {
        console.error(error);

        if (active) {
          await Swal.fire({
            icon: "error",
            title: "No se pudo cargar el recetario",
            text: error?.message || "Ocurrió un error.",
            confirmButtonColor: "#8b5e3c",
          });
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, []);

  const filteredRecipes = useMemo(() => {
    const query = search.trim().toLowerCase();

    return recipes.filter((recipe) => {
      const category = getRelatedObject(recipe.categories);

      const matchesCategory =
        categoryFilter === "all" || recipe.category_id === categoryFilter;

      const matchesSearch =
        !query ||
        recipe.name.toLowerCase().includes(query) ||
        category?.name?.toLowerCase().includes(query);

      return matchesCategory && matchesSearch;
    });
  }, [categoryFilter, recipes, search]);

  const handleDeleteRecipe = async (recipe) => {
    try {
      const { data: usages, error: usageError } = await supabase
        .from("recipe_subrecipes")
        .select(
          `
            recipe_id,

            parent_recipe:recipes!recipe_subrecipes_recipe_fk (
              name
            )
          `,
        )
        .eq("subrecipe_id", recipe.id);

      if (usageError) {
        throw usageError;
      }

      if (usages && usages.length > 0) {
        const names = usages
          .map((usage) => {
            const parent = getRelatedObject(usage.parent_recipe);

            return parent?.name || "Otra receta";
          })
          .join(", ");

        await Swal.fire({
          icon: "warning",
          title: "No puedes eliminarla todavía",
          html: `
              <p>
                <strong>${recipe.name}</strong>
                se está utilizando como ingrediente en:
              </p>

              <p style="
                margin-top:12px;
                font-weight:700;
              ">
                ${names}
              </p>

              <p style="margin-top:12px">
                Primero quítala de esas recetas.
              </p>
            `,
          confirmButtonColor: "#8b5e3c",
        });

        return;
      }

      const confirmation = await Swal.fire({
        icon: "warning",
        title: "¿Eliminar receta?",
        html: `
              <p>
                Se eliminará
                <strong>
                  ${recipe.name}
                </strong>.
              </p>

              <p style="
                margin-top:12px;
                color:#b91c1c;
                font-weight:700;
              ">
                Esta acción no se puede deshacer.
              </p>
            `,
        showCancelButton: true,
        confirmButtonText: "Sí, eliminar",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#b91c1c",
        cancelButtonColor: "#78716c",
        reverseButtons: true,
      });

      if (!confirmation.isConfirmed) {
        return;
      }

      setDeletingId(recipe.id);

      Swal.fire({
        title: "Eliminando receta",
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
      });

      const { error: productionsError } = await supabase
        .from("production_batches")
        .delete()
        .eq("recipe_id", recipe.id);

      if (productionsError) {
        throw productionsError;
      }

      const { error: recipeError } = await supabase
        .from("recipes")
        .delete()
        .eq("id", recipe.id);

      if (recipeError) {
        throw recipeError;
      }

      setRecipes((current) => current.filter((item) => item.id !== recipe.id));

      await Swal.fire({
        icon: "success",
        title: "Receta eliminada",
        timer: 1500,
        showConfirmButton: false,
      });
    } catch (error) {
      console.error(error);

      await Swal.fire({
        icon: "error",
        title: "No se pudo eliminar",
        text: error?.message || "Ocurrió un error.",
        confirmButtonColor: "#8b5e3c",
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[.16em] text-orange-700">
            Recetario
          </p>

          <h1 className="mt-1 text-3xl font-black text-stone-900">
            Mis recetas
          </h1>
        </div>

        <Link
          href="/dashboard/recetas/nueva"
          className="rounded-xl bg-[#8b5e3c] px-5 py-3 text-center text-sm font-black text-white shadow-md hover:bg-[#70472d]"
        >
          + Nueva receta
        </Link>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar receta..."
            className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-3"
          />

          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-3"
          >
            <option value="all">Todas las categorías</option>

            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {loading ? (
        <div className="rounded-2xl border bg-white py-20 text-center text-stone-500">
          Cargando...
        </div>
      ) : filteredRecipes.length === 0 ? (
        <div className="rounded-2xl border bg-white py-20 text-center">
          No hay recetas.
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredRecipes.map((recipe) => {
            const category = getRelatedObject(recipe.categories);

            const costs = recipe.breakdown ?? {};

            const directCount = recipe.recipe_ingredients?.length ?? 0;

            const recipeCount = recipe.recipe_subrecipes?.length ?? 0;

            return (
              <article
                key={recipe.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
              >
                <div className="border-b border-stone-100 bg-gradient-to-br from-[#f4e9dc] to-[#fffaf5] p-6">
                  <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-black text-[#8b5e3c]">
                    {category?.name || "Sin categoría"}
                  </span>

                  <h2 className="mt-4 text-xl font-black text-[#3b2a20]">
                    {recipe.name}
                  </h2>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-stone-600">
                    <span className="rounded-full bg-white px-3 py-1.5">
                      Rinde {quantity(recipe.yield_quantity)}{" "}
                      {recipe.yield_unit}
                    </span>

                    <span className="rounded-full bg-white px-3 py-1.5">
                      {directCount} insumo(s)
                    </span>

                    {recipeCount > 0 && (
                      <span className="rounded-full bg-white px-3 py-1.5">
                        {recipeCount} receta(s)
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex-1 space-y-3 p-6 text-sm">
                  <CostRow label="Costo lote" value={money(costs.total_cost)} />

                  <CostRow
                    label={`Costo / ${recipe.yield_unit}`}
                    value={money(costs.cost_per_unit)}
                  />

                  <CostRow
                    label={`Costo = ${recipe.cost_percentage}%`}
                    value={money(costs.cost_per_unit)}
                  />

                  <CostRow
                    label={`Merma ${recipe.waste_percentage}%`}
                    value={money(costs.waste_per_unit)}
                  />

                  <div className="mt-4 rounded-xl bg-[#3b2a20] p-4 text-white">
                    <p className="text-xs font-black uppercase tracking-[.14em] text-orange-200">
                      Precio final por {recipe.yield_unit}
                    </p>

                    <p className="mt-2 text-2xl font-black">
                      {money(costs.final_price_per_unit)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 border-t border-stone-100 bg-stone-50 p-5">
                  <Link
                    href={`/dashboard/recetas/${recipe.id}`}
                    className="rounded-xl bg-[#8b5e3c] px-4 py-3 text-center text-sm font-black text-white"
                  >
                    Abrir
                  </Link>

                  <button
                    type="button"
                    disabled={deletingId === recipe.id}
                    onClick={() => handleDeleteRecipe(recipe)}
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700"
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CostRow({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-stone-500">{label}</span>

      <strong className="text-stone-800">{value}</strong>
    </div>
  );
}
