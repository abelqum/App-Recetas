"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

const money = (value) =>
  Number(value || 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
  });

const quantity = (value) =>
  Number(value || 0).toLocaleString("es-MX", {
    maximumFractionDigits: 2,
  });

async function getDashboardData() {
  const [
    ingredientsResult,
    recipesResult,
    categoriesResult,
    productionsResult,
    configResult,
  ] = await Promise.all([
    supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, minimum_stock, average_unit_cost")
      .eq("is_active", true)
      .order("name"),
    supabase.from("recipes").select("id", { count: "exact", head: true }),
    supabase.from("categories").select("id", { count: "exact", head: true }),
    supabase
      .from("production_batches")
      .select(
        `
            id,
            batches,
            production_cost,
            created_at,
            recipes (name)
          `,
      )
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("app_config")
      .select("business_name")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const results = [
    ingredientsResult,
    recipesResult,
    categoriesResult,
    productionsResult,
    configResult,
  ];

  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;

  return {
    ingredients: ingredientsResult.data ?? [],
    recipeCount: recipesResult.count ?? 0,
    categoryCount: categoriesResult.count ?? 0,
    productions: productionsResult.data ?? [],
    businessName: configResult.data?.business_name?.trim() || "Mi negocio",
  };
}

function relatedRecipeName(relation) {
  if (Array.isArray(relation)) return relation[0]?.name || "Receta";
  return relation?.name || "Receta";
}

export default function DashboardPage() {
  const [data, setData] = useState({
    ingredients: [],
    recipeCount: 0,
    categoryCount: 0,
    productions: [],
    businessName: "Mi negocio",
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const dashboardData = await getDashboardData();
        if (active) setData(dashboardData);
      } catch (error) {
        console.error(error);
        if (active) {
          await Swal.fire({
            icon: "error",
            title: "No se pudo cargar el panel",
            text: error.message,
            confirmButtonColor: "#8b5e3c",
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const summary = useMemo(
    () =>
      data.ingredients.reduce(
        (result, item) => {
          const stock = Number(item.current_stock) || 0;
          const minimum = Number(item.minimum_stock) || 0;
          const unitCost = Number(item.average_unit_cost) || 0;

          result.inventoryValue += stock * unitCost;

          if (minimum > 0 && stock <= minimum) {
            result.lowStock.push(item);
          }

          if (stock <= 0) result.outOfStock += 1;

          return result;
        },
        { inventoryValue: 0, lowStock: [], outOfStock: 0 },
      ),
    [data.ingredients],
  );

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-orange-100 border-t-[#8b5e3c]" />
          <p className="font-medium text-stone-500">Cargando panel...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <section className="relative overflow-hidden rounded-[2rem] bg-[#3b2a20] px-7 py-9 text-white shadow-xl shadow-stone-900/10 sm:px-10 sm:py-11">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-orange-400/15 blur-2xl" />
        <div className="relative max-w-2xl">
          <p className="text-sm font-black uppercase tracking-[.18em] text-orange-300">
            Resumen general
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
            Bienvenida a {data.businessName}.
          </h1>
          <p className="mt-4 max-w-xl leading-7 text-stone-300">
            Revisa existencias, organiza tus categorías y registra la producción
            real de cada receta.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/dashboard/recetas/nueva"
              className="rounded-xl bg-orange-500 px-5 py-3 text-sm font-black text-white transition hover:bg-orange-600"
            >
              Crear nueva receta
            </Link>
            <Link
              href="/dashboard/inventario"
              className="rounded-xl border border-white/20 bg-white/10 px-5 py-3 text-sm font-black text-white transition hover:bg-white/15"
            >
              Administrar inventario
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon="▦"
          label="Ingredientes"
          value={data.ingredients.length}
          detail="Activos en inventario"
        />
        <SummaryCard
          icon="▤"
          label="Recetas"
          value={data.recipeCount}
          detail="Preparaciones registradas"
        />
        <SummaryCard
          icon="◫"
          label="Categorías"
          value={data.categoryCount}
          detail="Tipos de receta"
        />
        <SummaryCard
          icon="⚠"
          label="Stock bajo"
          value={summary.lowStock.length}
          detail={`${summary.outOfStock} agotado(s)`}
          alert={summary.lowStock.length > 0}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-stone-100 px-6 py-5">
            <div>
              <h2 className="text-xl font-black text-stone-900">
                Ingredientes por terminarse
              </h2>
              <p className="mt-1 text-sm text-stone-500">
                Existencias iguales o menores al mínimo definido.
              </p>
            </div>
            <Link
              href="/dashboard/inventario"
              className="text-sm font-black text-orange-700 hover:text-orange-900"
            >
              Ver inventario
            </Link>
          </div>

          {summary.lowStock.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="text-4xl">✓</div>
              <p className="mt-3 font-black text-stone-800">
                Todo está bajo control
              </p>
              <p className="mt-1 text-sm text-stone-500">
                Ningún ingrediente ha llegado a su mínimo.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {summary.lowStock.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-4 px-6 py-4"
                >
                  <div>
                    <p className="font-black text-stone-900">{item.name}</p>
                    <p className="mt-1 text-xs text-stone-500">
                      Mínimo: {quantity(item.minimum_stock)} {item.unit}
                    </p>
                  </div>
                  <span className="rounded-xl bg-red-50 px-3 py-2 text-sm font-black text-red-700">
                    {quantity(item.current_stock)} {item.unit}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-stone-100 px-6 py-5">
            <div>
              <h2 className="text-xl font-black text-stone-900">
                Producciones recientes
              </h2>
              <p className="mt-1 text-sm text-stone-500">
                Últimos lotes descontados del inventario.
              </p>
            </div>
            <Link
              href="/dashboard/recetas"
              className="text-sm font-black text-orange-700 hover:text-orange-900"
            >
              Ver recetas
            </Link>
          </div>

          {data.productions.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="text-4xl">🍪</div>
              <p className="mt-3 font-black text-stone-800">
                Todavía no hay producciones
              </p>
              <p className="mt-1 text-sm text-stone-500">
                Abre una receta y utiliza “Producir receta”.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {data.productions.map((production) => (
                <div
                  key={production.id}
                  className="flex items-center justify-between gap-4 px-6 py-4"
                >
                  <div>
                    <p className="font-black text-stone-900">
                      {relatedRecipeName(production.recipes)}
                    </p>
                    <p className="mt-1 text-xs text-stone-500">
                      {production.batches} lote(s) ·{" "}
                      {new Date(production.created_at).toLocaleDateString(
                        "es-MX",
                      )}
                    </p>
                  </div>
                  <span className="font-black text-orange-800">
                    {money(production.production_cost)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-stone-500">
              Valor aproximado del inventario
            </p>
            <p className="mt-1 text-3xl font-black text-[#3b2a20]">
              {money(summary.inventoryValue)}
            </p>
          </div>
          <p className="max-w-lg text-sm leading-6 text-stone-500">
            Se calcula usando el stock actual y el costo promedio de cada
            ingrediente.
          </p>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ icon, label, value, detail, alert = false }) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-stone-500">{label}</p>
          <p
            className={`mt-2 text-3xl font-black ${
              alert ? "text-red-600" : "text-stone-900"
            }`}
          >
            {value}
          </p>
          <p className="mt-1 text-xs text-stone-400">{detail}</p>
        </div>
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-2xl text-orange-900">
          {icon}
        </span>
      </div>
    </article>
  );
}
