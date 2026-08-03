"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

const money = (value, digits = 2) => Number(value || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: digits, maximumFractionDigits: digits });
const quantity = (value) => Number(value || 0).toLocaleString("es-MX", { maximumFractionDigits: 2 });

export default function InventarioPage() {
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", unit: "g", purchaseQuantity: "", purchaseCost: "" });

  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await supabase.from("ingredients").select("*").order("created_at", { ascending: false });
      if (!active) return;
      if (error) {
        console.error(error);
        void Swal.fire({ icon: "error", title: "No se pudo cargar el inventario", text: error.message, confirmButtonColor: "#8b5e3c" });
      } else setIngredients(data ?? []);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => ingredients.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase())), [ingredients, search]);
  const stockValue = useMemo(() => ingredients.reduce((sum, item) => {
    const purchased = Number(item.purchase_quantity) || 0;
    const cost = Number(item.purchase_cost) || 0;
    const stock = Number(item.current_stock) || 0;
    return sum + (purchased > 0 ? cost / purchased : 0) * stock;
  }, 0), [ingredients]);

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    const name = form.name.trim();
    const purchaseQuantity = Number(form.purchaseQuantity);
    const purchaseCost = Number(form.purchaseCost);

    if (!name || purchaseQuantity <= 0 || purchaseCost < 0) {
      await Swal.fire({ icon: "warning", title: "Revisa los datos", text: "Escribe un nombre, una cantidad mayor que cero y un costo válido.", confirmButtonColor: "#8b5e3c" });
      return;
    }

    try {
      setIsSubmitting(true);
      const { data, error } = await supabase.from("ingredients").insert({ name, unit: form.unit, purchase_quantity: purchaseQuantity, purchase_cost: purchaseCost, current_stock: purchaseQuantity }).select().single();
      if (error) throw error;
      setIngredients((current) => [data, ...current]);
      setForm({ name: "", unit: "g", purchaseQuantity: "", purchaseCost: "" });
      await Swal.fire({ icon: "success", title: "Insumo guardado", text: `${name} se agregó al inventario.`, timer: 1500, showConfirmButton: false });
    } catch (error) {
      await Swal.fire({ icon: "error", title: "No se pudo guardar", text: error.message, confirmButtonColor: "#8b5e3c" });
    } finally { setIsSubmitting(false); }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <div>
        <p className="text-sm font-black uppercase tracking-[.16em] text-orange-700">Inventario</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-stone-900">Insumos disponibles</h1>
        <p className="mt-2 text-stone-500">Registra compras y conoce el costo de cada gramo, mililitro o pieza.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-stone-500">Insumos registrados</p><p className="mt-2 text-3xl font-black text-stone-900">{ingredients.length}</p></div>
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-stone-500">Con stock bajo</p><p className="mt-2 text-3xl font-black text-red-600">{ingredients.filter((i) => Number(i.current_stock) < Number(i.purchase_quantity) * .2).length}</p></div>
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-stone-500">Valor aproximado</p><p className="mt-2 text-3xl font-black text-orange-700">{money(stockValue)}</p></div>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="mb-6"><h2 className="text-xl font-black text-stone-900">Agregar insumo</h2><p className="mt-1 text-sm text-stone-500">Captura la presentación comprada usando la unidad base correspondiente.</p></div>
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="xl:col-span-2"><span className="mb-2 block text-sm font-bold text-stone-700">Nombre</span><input value={form.name} onChange={(e) => updateForm("name", e.target.value)} required placeholder="Ej. Harina de trigo" className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100" /></label>
          <label><span className="mb-2 block text-sm font-bold text-stone-700">Unidad base</span><select value={form.unit} onChange={(e) => updateForm("unit", e.target.value)} className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"><option value="g">Gramos (g)</option><option value="ml">Mililitros (ml)</option><option value="pz">Piezas (pz)</option></select></label>
          <label><span className="mb-2 block text-sm font-bold text-stone-700">Cantidad comprada</span><input type="number" min="0.01" step="0.01" value={form.purchaseQuantity} onChange={(e) => updateForm("purchaseQuantity", e.target.value)} required placeholder="1000" className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100" /></label>
          <label><span className="mb-2 block text-sm font-bold text-stone-700">Costo total</span><input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => updateForm("purchaseCost", e.target.value)} required placeholder="45.00" className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100" /></label>
          <div className="md:col-span-2 xl:col-span-5 flex justify-end"><button disabled={isSubmitting} className="rounded-xl bg-[#8b5e3c] px-6 py-3 font-black text-white transition hover:bg-[#70472d] disabled:opacity-60">{isSubmitting ? "Guardando..." : "Guardar insumo"}</button></div>
        </form>
      </section>

      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-stone-200 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-black text-stone-900">Lista de insumos</h2><p className="text-sm text-stone-500">{filtered.length} resultado(s)</p></div><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar insumo..." className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100 sm:max-w-xs" /></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left"><thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500"><tr><th className="px-5 py-4">Insumo</th><th className="px-5 py-4 text-right">Compra</th><th className="px-5 py-4 text-right">Costo</th><th className="px-5 py-4 text-right">Costo unitario</th><th className="px-5 py-4 text-right">Stock</th></tr></thead>
            <tbody className="divide-y divide-stone-100">{loading ? <tr><td colSpan={5} className="px-5 py-12 text-center text-stone-500">Cargando inventario...</td></tr> : filtered.length === 0 ? <tr><td colSpan={5} className="px-5 py-12 text-center text-stone-500">No hay insumos para mostrar.</td></tr> : filtered.map((item) => { const purchased = Number(item.purchase_quantity) || 0; const cost = Number(item.purchase_cost) || 0; const stock = Number(item.current_stock) || 0; const low = stock < purchased * .2; return <tr key={item.id} className="hover:bg-orange-50/40"><td className="px-5 py-4 font-black text-stone-800">{item.name}<span className="ml-2 rounded-full bg-stone-100 px-2 py-1 text-xs text-stone-500">{item.unit}</span></td><td className="px-5 py-4 text-right text-stone-600">{quantity(purchased)} {item.unit}</td><td className="px-5 py-4 text-right font-bold text-stone-700">{money(cost)}</td><td className="px-5 py-4 text-right text-stone-500">{money(purchased > 0 ? cost / purchased : 0, 4)} / {item.unit}</td><td className="px-5 py-4 text-right"><span className={`rounded-full px-3 py-1.5 text-xs font-black ${low ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>{quantity(stock)} {item.unit}</span></td></tr>; })}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
