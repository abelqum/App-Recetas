"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

async function getRecipesPageData() {
  const [recipesResult, categoriesResult, configResult] = await Promise.all([
    supabase
      .from("recipes")
      .select(
        `
        id,
        name,
        category_id,
        labor_cost,
        profit_margin_percent,
        electric_time_minutes,
        gas_time_minutes,
        oven_time_minutes,
        created_at,
        categories (
          id,
          name
        ),
        recipe_ingredients (
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
      .order("created_at", { ascending: false }),

    supabase
      .from("categories")
      .select("id, name")
      .order("name", { ascending: true }),

    supabase
      .from("app_config")
      .select(
        "kwh_cost, electric_power_watts, oven_power_watts, gas_hourly_cost",
      )
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (recipesResult.error) throw recipesResult.error;
  if (categoriesResult.error) throw categoriesResult.error;
  if (configResult.error) throw configResult.error;

  return {
    recipes: recipesResult.data ?? [],
    categories: categoriesResult.data ?? [],
    config: configResult.data ?? {
      kwh_cost: 0,
      electric_power_watts: 0,
      oven_power_watts: 0,
      gas_hourly_cost: 0,
    },
  };
}

function getRelatedObject(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

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

function calculateRecipeCost(recipe, config) {
  const ingredientCost = (recipe.recipe_ingredients ?? []).reduce(
    (total, relation) => {
      const ingredient = getRelatedObject(relation.ingredients);

      if (!ingredient) return total;

      const storedAverageCost = Number(ingredient.average_unit_cost);
      const purchaseQuantity = Number(ingredient.purchase_quantity) || 0;
      const purchaseCost = Number(ingredient.purchase_cost) || 0;
      const fallbackUnitCost =
        purchaseQuantity > 0 ? purchaseCost / purchaseQuantity : 0;

      const unitCost =
        Number.isFinite(storedAverageCost) && storedAverageCost > 0
          ? storedAverageCost
          : fallbackUnitCost;

      return total + unitCost * Number(relation.quantity_needed || 0);
    },
    0,
  );

  const electricPower =
    Number(config.electric_power_watts) || Number(config.oven_power_watts) || 0;

  const electricCost =
    (electricPower / 1000) *
    (Number(recipe.electric_time_minutes || 0) / 60) *
    Number(config.kwh_cost || 0);

  const gasCost =
    (Number(recipe.gas_time_minutes || 0) / 60) *
    Number(config.gas_hourly_cost || 0);

  const laborCost = Number(recipe.labor_cost || 0);
  const totalCost = ingredientCost + electricCost + gasCost + laborCost;
  const profitPercent = Number(recipe.profit_margin_percent || 0);
  const profitAmount = totalCost * (profitPercent / 100);

  return {
    ingredientCost,
    electricCost,
    gasCost,
    laborCost,
    totalCost,
    profitPercent,
    profitAmount,
    finalPrice: totalCost + profitAmount,
  };
}

export default function RecetasPage() {
  const [recipes, setRecipes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [config, setConfig] = useState({
    kwh_cost: 0,
    electric_power_watts: 0,
    oven_power_watts: 0,
    gas_hourly_cost: 0,
  });

  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  useEffect(() => {
    let active = true;

    async function loadRecipes() {
      try {
        const data = await getRecipesPageData();

        if (active) {
          setRecipes(data.recipes);
          setCategories(data.categories);
          setConfig(data.config);
        }
      } catch (error) {
        console.error("Error al cargar recetas:", error);

        if (active) {
          await Swal.fire({
            icon: "error",
            title: "No se pudo cargar el recetario",
            text: error.message,
            confirmButtonColor: "#8b5e3c",
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadRecipes();

    return () => {
      active = false;
    };
  }, []);

  const filteredRecipes = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return recipes.filter((recipe) => {
      const category = getRelatedObject(recipe.categories);
      const matchesCategory =
        categoryFilter === "all" || recipe.category_id === categoryFilter;
      const matchesSearch =
        !normalizedSearch ||
        recipe.name.toLowerCase().includes(normalizedSearch) ||
        category?.name?.toLowerCase().includes(normalizedSearch);

      return matchesCategory && matchesSearch;
    });
  }, [categoryFilter, recipes, search]);

  const handleDeleteRecipe = async (recipe) => {
    const confirmation = await Swal.fire({
      icon: "warning",
      title: "¿Eliminar receta?",
      html: `
        <p>Se eliminará <strong>${recipe.name}</strong>, sus ingredientes relacionados, sus pasos y su historial de producciones.</p>
        <p style="margin-top:12px;color:#b91c1c;font-weight:700">Esta acción no se puede deshacer.</p>
      `,
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#b91c1c",
      cancelButtonColor: "#78716c",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) return;

    try {
      setDeletingId(recipe.id);

      Swal.fire({
        title: "Eliminando receta",
        text: "Espera un momento...",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading(),
      });

      const { error: productionsError } = await supabase
        .from("production_batches")
        .delete()
        .eq("recipe_id", recipe.id);

      if (productionsError) throw productionsError;

      const { error: recipeError } = await supabase
        .from("recipes")
        .delete()
        .eq("id", recipe.id);

      if (recipeError) throw recipeError;

      setRecipes((current) => current.filter((item) => item.id !== recipe.id));

      await Swal.fire({
        icon: "success",
        title: "Receta eliminada",
        text: `${recipe.name} se eliminó correctamente.`,
        timer: 1700,
        showConfirmButton: false,
      });
    } catch (error) {
      console.error("Error al eliminar receta:", error);

      await Swal.fire({
        icon: "error",
        title: "No se pudo eliminar",
        text: error.message,
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
          <h1 className="mt-1 text-3xl font-black tracking-tight text-stone-900">
            Mis recetas
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
            Consulta el costo de preparación, la utilidad y el precio final de
            cada receta.
          </p>
        </div>

        <Link
          href="/dashboard/recetas/nueva"
          className="rounded-xl bg-[#8b5e3c] px-5 py-3 text-center text-sm font-black text-white shadow-md shadow-stone-900/10 transition hover:bg-[#70472d]"
        >
          + Nueva receta
        </Link>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          <label>
            <span className="mb-2 block text-sm font-bold text-stone-700">
              Buscar receta
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre o categoría..."
              className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
            />
          </label>

          <label>
            <span className="mb-2 block text-sm font-bold text-stone-700">
              Categoría
            </span>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
            >
              <option value="all">Todas las categorías</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {loading ? (
        <div className="rounded-2xl border border-stone-200 bg-white py-20 text-center text-stone-500 shadow-sm">
          Cargando recetario...
        </div>
      ) : filteredRecipes.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white px-6 py-16 text-center shadow-sm">
          <div className="mb-4 text-5xl">🍪</div>
          <h2 className="text-xl font-black text-stone-900">
            No hay recetas para mostrar
          </h2>
          <p className="mt-2 text-sm text-stone-500">
            Crea una receta o cambia los filtros de búsqueda.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredRecipes.map((recipe) => {
            const category = getRelatedObject(recipe.categories);
            const costs = calculateRecipeCost(recipe, config);
            const ingredientCount = recipe.recipe_ingredients?.length ?? 0;
            const isDeleting = deletingId === recipe.id;

            return (
              <article
                key={recipe.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
              >
                <div className="border-b border-stone-100 bg-gradient-to-br from-[#f4e9dc] to-[#fffaf5] p-6">
                  <span className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-black text-[#8b5e3c]">
                    {category?.name || "Sin categoría"}
                  </span>

                  <h2 className="mt-3 text-xl font-black leading-tight text-[#3b2a20]">
                    {recipe.name}
                  </h2>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-stone-600">
                    <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">
                      {ingredientCount} ingrediente(s)
                    </span>
                    <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">
                      ⚡ {quantity(recipe.electric_time_minutes)} min
                    </span>
                    <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">
                      🔥 {quantity(recipe.gas_time_minutes)} min
                    </span>
                    <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">
                      {quantity(costs.profitPercent)}% utilidad
                    </span>
                  </div>
                </div>

                <div className="flex-1 space-y-3 p-6 text-sm">
                  <CostRow
                    label="Ingredientes"
                    value={money(costs.ingredientCost)}
                  />
                  <CostRow
                    label="Electricidad"
                    value={money(costs.electricCost)}
                  />
                  <CostRow label="Gas" value={money(costs.gasCost)} />
                  <CostRow
                    label="Mano de obra"
                    value={money(costs.laborCost)}
                  />
                  <div className="border-t border-stone-200 pt-3">
                    <CostRow
                      label="Costo total"
                      value={money(costs.totalCost)}
                      emphasized
                    />
                  </div>
                  <CostRow
                    label={`Utilidad (${quantity(costs.profitPercent)}%)`}
                    value={money(costs.profitAmount)}
                  />

                  <div className="mt-4 rounded-xl bg-[#3b2a20] p-4 text-white">
                    <p className="text-xs font-black uppercase tracking-[.14em] text-orange-200">
                      Precio final
                    </p>
                    <p className="mt-2 text-2xl font-black">
                      {money(costs.finalPrice)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 border-t border-stone-100 bg-stone-50 p-5">
                  <Link
                    href={`/dashboard/recetas/${recipe.id}`}
                    className="col-span-2 rounded-xl bg-[#8b5e3c] px-4 py-3 text-center text-sm font-black text-white transition hover:bg-[#70472d]"
                  >
                    Ver, editar y producir
                  </Link>

                  <Link
                    href={`/dashboard/recetas/${recipe.id}`}
                    className="rounded-xl border border-[#8b5e3c] bg-white px-4 py-2.5 text-center text-sm font-black text-[#8b5e3c] transition hover:bg-orange-50"
                  >
                    Editar
                  </Link>

                  <button
                    type="button"
                    onClick={() => handleDeleteRecipe(recipe)}
                    disabled={isDeleting}
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
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
