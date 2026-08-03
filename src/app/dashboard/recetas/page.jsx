"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

async function getRecipesPageData() {
  const [recipesResult, configResult] = await Promise.all([
    supabase
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
      .from("app_config")
      .select("kwh_cost, oven_power_watts")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (recipesResult.error) throw recipesResult.error;
  if (configResult.error) throw configResult.error;

  return {
    recipes: recipesResult.data ?? [],
    config: configResult.data ?? {
      kwh_cost: 0,
      oven_power_watts: 0,
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

  const electricityCost =
    (Number(config.oven_power_watts || 0) / 1000) *
    (Number(recipe.oven_time_minutes || 0) / 60) *
    Number(config.kwh_cost || 0);

  const laborCost = Number(recipe.labor_cost || 0);

  return {
    ingredientCost,
    electricityCost,
    laborCost,
    totalCost: ingredientCost + electricityCost + laborCost,
  };
}

export default function RecetasPage() {
  const [recipes, setRecipes] = useState([]);
  const [config, setConfig] = useState({
    kwh_cost: 0,
    oven_power_watts: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  useEffect(() => {
    let active = true;

    async function loadRecipes() {
      try {
        const data = await getRecipesPageData();

        if (active) {
          setRecipes(data.recipes);
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

  const categories = useMemo(() => {
    const categoryMap = new Map();

    recipes.forEach((recipe) => {
      const category = getRelatedObject(recipe.categories);
      if (category) categoryMap.set(category.id, category);
    });

    return Array.from(categoryMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "es"),
    );
  }, [recipes]);

  const filteredRecipes = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return recipes.filter((recipe) => {
      const category = getRelatedObject(recipe.categories);
      const matchesCategory =
        categoryFilter === "all" || category?.id === categoryFilter;
      const matchesSearch =
        !normalizedSearch ||
        recipe.name.toLowerCase().includes(normalizedSearch) ||
        category?.name?.toLowerCase().includes(normalizedSearch);

      return matchesCategory && matchesSearch;
    });
  }, [categoryFilter, recipes, search]);

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
            Consulta el costo real de cada preparación y clasifica tus recetas
            por categoría.
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
            Crea una nueva receta o modifica los filtros de búsqueda.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredRecipes.map((recipe) => {
            const category = getRelatedObject(recipe.categories);
            const costs = calculateRecipeCost(recipe, config);
            const ingredientCount = recipe.recipe_ingredients?.length ?? 0;

            return (
              <article
                key={recipe.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="border-b border-stone-100 bg-gradient-to-r from-orange-50 to-stone-50 p-5">
                  <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-black text-orange-800 shadow-sm">
                    {category?.name || "Sin categoría"}
                  </span>
                  <h2 className="mt-3 text-xl font-black leading-tight text-stone-900">
                    {recipe.name}
                  </h2>
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <dl className="space-y-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-stone-500">Ingredientes</dt>
                      <dd className="font-bold text-stone-800">
                        {ingredientCount}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-stone-500">Tiempo de horno</dt>
                      <dd className="font-bold text-stone-800">
                        {Number(recipe.oven_time_minutes || 0)} min
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-stone-500">Ingredientes</dt>
                      <dd className="font-bold text-stone-800">
                        {money(costs.ingredientCost)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-stone-500">Electricidad</dt>
                      <dd className="font-bold text-stone-800">
                        {money(costs.electricityCost)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4 border-t border-stone-100 pt-3">
                      <dt className="font-black text-stone-800">Costo total</dt>
                      <dd className="text-lg font-black text-[#8b5e3c]">
                        {money(costs.totalCost)}
                      </dd>
                    </div>
                  </dl>

                  <Link
                    href={`/dashboard/recetas/${recipe.id}`}
                    className="mt-5 block rounded-xl bg-[#3b2a20] px-4 py-3 text-center text-sm font-black text-white transition hover:bg-[#2c1f18]"
                  >
                    Ver, editar y producir
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
