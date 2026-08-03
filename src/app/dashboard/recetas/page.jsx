"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

const formatCurrency = (value) =>
  Number(value || 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatQuantity = (value) =>
  Number(value || 0).toLocaleString("es-MX", {
    maximumFractionDigits: 2,
  });

const getRelatedCategory = (relation) => {
  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation ?? null;
};

const getRelatedIngredient = (relation) => {
  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation ?? null;
};

async function getRecipes() {
  const { data, error } = await supabase
    .from("recipes")
    .select(
      `
      id,
      name,
      category_id,
      labor_cost,
      oven_time_minutes,
      created_at,
      categories (
        id,
        name
      ),
      recipe_ingredients (
        id,
        quantity_needed,
        ingredients (
          id,
          name,
          unit,
          purchase_cost,
          purchase_quantity,
          average_unit_cost
        )
      )
    `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function getCategories() {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function getElectricityConfig() {
  const { data, error } = await supabase
    .from("app_config")
    .select("kwh_cost, oven_power_watts")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return {
    kwhCost: Number(data?.kwh_cost) || 0,
    ovenPowerWatts: Number(data?.oven_power_watts) || 0,
  };
}

export default function RecetasPage() {
  const [recipes, setRecipes] = useState([]);
  const [categories, setCategories] = useState([]);

  const [electricityConfig, setElectricityConfig] = useState({
    kwhCost: 0,
    ovenPowerWatts: 0,
  });

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  const [loading, setLoading] = useState(true);
  const [deletingRecipeId, setDeletingRecipeId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPageData() {
      try {
        const [recipesData, categoriesData, configData] = await Promise.all([
          getRecipes(),
          getCategories(),
          getElectricityConfig(),
        ]);

        if (cancelled) {
          return;
        }

        setRecipes(recipesData);
        setCategories(categoriesData);
        setElectricityConfig(configData);
      } catch (error) {
        console.error("Error al cargar las recetas:", error);

        if (!cancelled) {
          await Swal.fire({
            icon: "error",
            title: "No se pudieron cargar las recetas",
            text:
              error?.message || "Ocurrió un error al consultar el recetario.",
            confirmButtonColor: "#8b5e3c",
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPageData();

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshRecipes = async () => {
    const recipesData = await getRecipes();
    setRecipes(recipesData);
  };

  const calculateRecipeCosts = (recipe) => {
    const ingredientCost = (recipe.recipe_ingredients ?? []).reduce(
      (total, recipeIngredient) => {
        const ingredient = getRelatedIngredient(recipeIngredient.ingredients);

        if (!ingredient) {
          return total;
        }

        const storedAverageUnitCost = Number(ingredient.average_unit_cost);

        const purchaseQuantity = Number(ingredient.purchase_quantity) || 0;

        const purchaseCost = Number(ingredient.purchase_cost) || 0;

        const fallbackUnitCost =
          purchaseQuantity > 0 ? purchaseCost / purchaseQuantity : 0;

        const unitCost =
          Number.isFinite(storedAverageUnitCost) && storedAverageUnitCost > 0
            ? storedAverageUnitCost
            : fallbackUnitCost;

        const quantityNeeded = Number(recipeIngredient.quantity_needed) || 0;

        return total + unitCost * quantityNeeded;
      },
      0,
    );

    const ovenMinutes = Number(recipe.oven_time_minutes) || 0;

    const electricityCost =
      (electricityConfig.ovenPowerWatts / 1000) *
      (ovenMinutes / 60) *
      electricityConfig.kwhCost;

    const laborCost = Number(recipe.labor_cost) || 0;

    const totalCost = ingredientCost + electricityCost + laborCost;

    return {
      ingredientCost,
      electricityCost,
      laborCost,
      totalCost,
    };
  };

  const filteredRecipes = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return recipes.filter((recipe) => {
      const category = getRelatedCategory(recipe.categories);

      const matchesSearch =
        !normalizedSearch ||
        recipe.name.toLowerCase().includes(normalizedSearch) ||
        category?.name?.toLowerCase().includes(normalizedSearch);

      const matchesCategory =
        selectedCategory === "all" || recipe.category_id === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [recipes, search, selectedCategory]);

  const handleDeleteRecipe = async (recipe) => {
    const category = getRelatedCategory(recipe.categories);

    const confirmation = await Swal.fire({
      icon: "warning",
      title: "¿Eliminar esta receta?",
      html: `
        <div style="text-align: left;">
          <p>
            Se eliminará la receta
            <strong>${recipe.name}</strong>.
          </p>

          <p style="margin-top: 10px;">
            Categoría:
            <strong>${category?.name || "Sin categoría"}</strong>
          </p>

          <p style="
            margin-top: 16px;
            padding: 12px;
            border-radius: 10px;
            background: #fff7ed;
            color: #9a3412;
          ">
            También se eliminarán sus ingredientes relacionados,
            pasos e historial de producciones.
          </p>

          <p style="margin-top: 14px;">
            Esta acción no se puede deshacer.
          </p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar receta",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#b91c1c",
      cancelButtonColor: "#78716c",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      setDeletingRecipeId(recipe.id);

      Swal.fire({
        title: "Eliminando receta",
        text: "Estamos eliminando la información relacionada...",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          Swal.showLoading();
        },
      });

      /*
       * production_batches utiliza ON DELETE RESTRICT.
       * Por eso primero se elimina el historial de producciones.
       */
      const { error: productionsError } = await supabase
        .from("production_batches")
        .delete()
        .eq("recipe_id", recipe.id);

      if (productionsError) {
        throw productionsError;
      }

      /*
       * recipe_ingredients y recipe_steps tienen ON DELETE CASCADE,
       * por lo que se eliminan automáticamente junto con la receta.
       */
      const { error: recipeError } = await supabase
        .from("recipes")
        .delete()
        .eq("id", recipe.id);

      if (recipeError) {
        throw recipeError;
      }

      await refreshRecipes();

      await Swal.fire({
        icon: "success",
        title: "Receta eliminada",
        text: `${recipe.name} fue eliminada correctamente.`,
        confirmButtonColor: "#8b5e3c",
        timer: 1800,
        showConfirmButton: false,
      });
    } catch (error) {
      console.error("Error al eliminar la receta:", error);

      await Swal.fire({
        icon: "error",
        title: "No se pudo eliminar",
        text: error?.message || "Ocurrió un error al eliminar la receta.",
        confirmButtonColor: "#8b5e3c",
      });
    } finally {
      setDeletingRecipeId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-orange-100 border-t-[#8b5e3c]" />

          <p className="font-medium text-stone-500">Cargando recetario...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      {/* Encabezado */}
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-[#8b5e3c]">
            Recetario
          </p>

          <h1 className="text-3xl font-black tracking-tight text-[#3b2a20]">
            Mis recetas
          </h1>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
            Consulta, edita, produce o elimina las recetas registradas en el
            negocio.
          </p>
        </div>

        <Link
          href="/dashboard/recetas/nueva"
          className="inline-flex items-center justify-center rounded-2xl bg-[#3b2a20] px-6 py-3 font-black text-white shadow-lg shadow-stone-300 transition hover:-translate-y-0.5 hover:bg-[#4d382a]"
        >
          + Nueva receta
        </Link>
      </div>

      {/* Filtros */}
      <section className="mb-7 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          <div>
            <label
              htmlFor="recipe-search"
              className="mb-2 block text-sm font-bold text-stone-700"
            >
              Buscar receta
            </label>

            <input
              id="recipe-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre o categoría..."
              className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-[#3b2a20] outline-none transition placeholder:text-stone-400 focus:border-[#8b5e3c] focus:bg-white focus:ring-4 focus:ring-orange-100"
            />
          </div>

          <div>
            <label
              htmlFor="recipe-category"
              className="mb-2 block text-sm font-bold text-stone-700"
            >
              Categoría
            </label>

            <select
              id="recipe-category"
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
              className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-[#3b2a20] outline-none transition focus:border-[#8b5e3c] focus:bg-white focus:ring-4 focus:ring-orange-100"
            >
              <option value="all">Todas las categorías</option>

              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Estado vacío */}
      {filteredRecipes.length === 0 ? (
        <section className="rounded-3xl border border-stone-200 bg-white p-12 text-center shadow-sm">
          <div className="mb-4 text-5xl">🍪</div>

          <h2 className="text-xl font-black text-[#3b2a20]">
            No se encontraron recetas
          </h2>

          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-500">
            Cambia los filtros o registra una nueva receta para comenzar tu
            recetario.
          </p>

          <Link
            href="/dashboard/recetas/nueva"
            className="mt-6 inline-flex rounded-2xl bg-[#8b5e3c] px-6 py-3 font-black text-white transition hover:bg-[#6f482e]"
          >
            Crear receta
          </Link>
        </section>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {filteredRecipes.map((recipe) => {
            const category = getRelatedCategory(recipe.categories);

            const ingredientCount = recipe.recipe_ingredients?.length ?? 0;

            const costs = calculateRecipeCosts(recipe);

            const isDeleting = deletingRecipeId === recipe.id;

            return (
              <article
                key={recipe.id}
                className="flex flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
              >
                {/* Cabecera de la tarjeta */}
                <div className="border-b border-stone-100 bg-gradient-to-br from-[#f4e9dc] to-[#fffaf5] p-6">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <span className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-black text-[#8b5e3c]">
                        {category?.name || "Sin categoría"}
                      </span>

                      <h2 className="mt-3 line-clamp-2 text-xl font-black leading-tight text-[#3b2a20]">
                        {recipe.name}
                      </h2>
                    </div>

                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">
                      🍪
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs font-bold text-stone-600">
                    <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">
                      🧺 {ingredientCount} ingrediente
                      {ingredientCount === 1 ? "" : "s"}
                    </span>

                    <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">
                      ⏱ {formatQuantity(recipe.oven_time_minutes)} min
                    </span>
                  </div>
                </div>

                {/* Costos */}
                <div className="flex-1 p-6">
                  <h3 className="mb-4 text-sm font-black uppercase tracking-wider text-stone-400">
                    Costo por lote
                  </h3>

                  <div className="space-y-3 text-sm">
                    <CostRow
                      label="Ingredientes"
                      value={formatCurrency(costs.ingredientCost)}
                    />

                    <CostRow
                      label="Electricidad"
                      value={formatCurrency(costs.electricityCost)}
                    />

                    <CostRow
                      label="Mano de obra"
                      value={formatCurrency(costs.laborCost)}
                    />

                    <div className="border-t border-stone-200 pt-3">
                      <CostRow
                        label="Costo total"
                        value={formatCurrency(costs.totalCost)}
                        emphasized
                      />
                    </div>
                  </div>
                </div>

                {/* Acciones */}
                <div className="grid grid-cols-2 gap-3 border-t border-stone-100 bg-stone-50 p-5">
                  <Link
                    href={`/dashboard/recetas/${recipe.id}`}
                    className="col-span-2 rounded-2xl bg-[#3b2a20] px-4 py-3 text-center text-sm font-black text-white transition hover:bg-[#4d382a]"
                  >
                    Ver, editar y producir
                  </Link>

                  <Link
                    href={`/dashboard/recetas/${recipe.id}?edit=true`}
                    className="rounded-2xl border border-[#8b5e3c] bg-white px-4 py-2.5 text-center text-sm font-black text-[#8b5e3c] transition hover:bg-orange-50"
                  >
                    Editar
                  </Link>

                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => handleDeleteRecipe(recipe)}
                    className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isDeleting ? "Eliminando..." : "Eliminar"}
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

function CostRow({ label, value, emphasized = false }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span
        className={
          emphasized
            ? "font-black text-[#3b2a20]"
            : "font-medium text-stone-500"
        }
      >
        {label}
      </span>

      <span
        className={
          emphasized
            ? "text-lg font-black text-[#8b5e3c]"
            : "font-black text-stone-800"
        }
      >
        {value}
      </span>
    </div>
  );
}
