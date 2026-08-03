"use client";

import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

export default function ConfiguracionPage() {
  const [configId, setConfigId] = useState(null);
  const [kwhCost, setKwhCost] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await supabase.from("app_config").select("id, kwh_cost").limit(1).maybeSingle();
      if (!active) return;
      if (error) void Swal.fire({ icon: "error", title: "No se pudo cargar la configuración", text: error.message, confirmButtonColor: "#8b5e3c" });
      else if (data) { setConfigId(data.id); setKwhCost(String(data.kwh_cost ?? "")); }
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, []);

  const handleSave = async (event) => {
    event.preventDefault();
    const value = Number(kwhCost);
    if (!Number.isFinite(value) || value <= 0) {
      await Swal.fire({ icon: "warning", title: "Costo inválido", text: "Ingresa un costo por kWh mayor que cero.", confirmButtonColor: "#8b5e3c" });
      return;
    }
    try {
      setSaving(true);
      if (configId) {
        const { error } = await supabase.from("app_config").update({ kwh_cost: value, updated_at: new Date().toISOString() }).eq("id", configId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("app_config").insert({ kwh_cost: value }).select("id").single();
        if (error) throw error;
        setConfigId(data.id);
      }
      await Swal.fire({ icon: "success", title: "Configuración guardada", text: "El costo de energía ya se utilizará en tus recetas.", timer: 1600, showConfirmButton: false });
    } catch (error) {
      await Swal.fire({ icon: "error", title: "No se pudo guardar", text: error.message, confirmButtonColor: "#8b5e3c" });
    } finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <div><p className="text-sm font-black uppercase tracking-[.16em] text-orange-700">Preferencias</p><h1 className="mt-1 text-3xl font-black tracking-tight text-stone-900">Configuración del negocio</h1><p className="mt-2 text-stone-500">Define los valores generales utilizados en tus cálculos.</p></div>
      <div className="grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
        <section className="rounded-2xl border border-stone-200 bg-white p-7 shadow-sm"><div className="flex items-center gap-4"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-2xl">⚡</span><div><h2 className="text-xl font-black text-stone-900">Costo de energía</h2><p className="text-sm text-stone-500">Precio promedio por kilowatt-hora.</p></div></div>
          {loading ? <div className="mt-8 h-12 animate-pulse rounded-xl bg-stone-100" /> : <form onSubmit={handleSave} className="mt-8 space-y-5"><label><span className="mb-2 block text-sm font-bold text-stone-700">Costo por kWh (MXN)</span><div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-stone-400">$</span><input type="number" min="0.01" step="0.01" value={kwhCost} onChange={(e) => setKwhCost(e.target.value)} required placeholder="3.00" className="w-full rounded-xl border border-stone-300 bg-stone-50 py-3 pl-9 pr-4 outline-none focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100" /></div></label><button disabled={saving} className="w-full rounded-xl bg-[#8b5e3c] px-5 py-3 font-black text-white transition hover:bg-[#70472d] disabled:opacity-60">{saving ? "Guardando..." : "Guardar configuración"}</button></form>}
        </section>
        <aside className="rounded-2xl border border-orange-200 bg-orange-50 p-7"><p className="text-sm font-black uppercase tracking-[.14em] text-orange-700">Guía rápida</p><h2 className="mt-2 text-xl font-black text-stone-900">¿Cómo obtener el costo?</h2><p className="mt-3 leading-7 text-stone-600">Divide el total de tu recibo de luz entre los kWh consumidos. El resultado será una aproximación útil para tus recetas.</p><div className="mt-6 rounded-2xl border border-orange-200 bg-white p-5"><p className="text-sm text-stone-500">Ejemplo</p><div className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><span>Total del recibo</span><strong>$450.00</strong></div><div className="flex justify-between"><span>Consumo</span><strong>150 kWh</strong></div><div className="mt-3 flex justify-between border-t border-stone-200 pt-3 text-orange-700"><span className="font-black">Costo estimado</span><strong>$3.00 / kWh</strong></div></div></div><p className="mt-4 text-xs leading-5 text-stone-500">Es una estimación porque el recibo también puede incluir impuestos, cargos fijos y tarifas escalonadas.</p></aside>
      </div>
    </div>
  );
}
