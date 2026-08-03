"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

const money = (value) => Number(value || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

export default function RecetasPage() {
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await supabase.from("recipes").select("*").order("created_at", { ascending: false });
      if (!active) return;
      if (error) void Swal.fire({ icon: "error", title: "No se pudieron cargar las recetas", text: error.message, confirmButtonColor: "#8b5e3c" });
      else setRecipes(data ?? []);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => recipes.filter((recipe) => recipe.name.toLowerCase().includes(search.trim().toLowerCase())), [recipes, search]);

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-sm font-black uppercase tracking-[.16em] text-orange-700">Recetario</p><h1 className="mt-1 text-3xl font-black tracking-tight text-stone-900">Mis recetas</h1><p className="mt-2 text-stone-500">Consulta tus preparaciones y sus parámetros principales.</p></div>
        <Link href="/dashboard/recetas/nueva" className="rounded-xl bg-[#8b5e3c] px-5 py-3 text-center font-black text-white shadow-lg shadow-orange-900/10 transition hover:bg-[#70472d]">+ Nueva receta</Link>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar receta por nombre..." className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100" /></div>

      {loading ? <div className="rounded-2xl border border-stone-200 bg-white py-20 text-center text-stone-500">Cargando recetario...</div> : filtered.length === 0 ? (
        <div className="rounded-[2rem] border border-dashed border-stone-300 bg-white px-6 py-16 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-100 text-3xl">🍪</div><h2 className="mt-5 text-2xl font-black text-stone-900">{recipes.length ? "No encontramos coincidencias" : "Tu recetario está vacío"}</h2><p className="mx-auto mt-2 max-w-md text-stone-500">{recipes.length ? "Prueba con otro término de búsqueda." : "Agrega tu primera preparación para comenzar a calcular sus costos."}</p>{!recipes.length && <Link href="/dashboard/recetas/nueva" className="mt-6 inline-block rounded-xl bg-orange-600 px-5 py-3 font-black text-white">Crear primera receta</Link>}</div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{filtered.map((recipe) => (
          <article key={recipe.id} className="group flex min-h-72 flex-col rounded-2xl border border-stone-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-orange-200 hover:shadow-xl">
            <div className="flex items-start justify-between gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-2xl">▤</span><span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-black text-stone-500">{Number(recipe.profit_margin_percent) || 0}% ganancia</span></div>
            <h2 className="mt-6 text-xl font-black text-stone-900">{recipe.name}</h2>
            <div className="mt-5 space-y-3 rounded-xl bg-stone-50 p-4 text-sm"><div className="flex justify-between"><span className="text-stone-500">Tiempo de horno</span><strong className="text-stone-800">{Number(recipe.oven_time_minutes) || 0} min</strong></div><div className="flex justify-between"><span className="text-stone-500">Mano de obra</span><strong className="text-stone-800">{money(recipe.labor_cost)}</strong></div></div>
            <Link href={`/dashboard/recetas/${recipe.id}`} className="mt-auto pt-6 font-black text-orange-700 transition group-hover:translate-x-1">Ver receta completa →</Link>
          </article>
        ))}</div>
      )}
    </div>
  );
}
