"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

const money = (value, digits = 2) =>
  Number(value || 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const quantity = (value) =>
  Number(value || 0).toLocaleString("es-MX", {
    maximumFractionDigits: 2,
  });

async function getInventoryData() {
  const [ingredientsResult, configResult] = await Promise.all([
    supabase
      .from("ingredients")
      .select(
        `
          id,
          name,
          unit,
          purchase_quantity,
          purchase_cost,
          current_stock,
          minimum_stock,
          average_unit_cost,
          is_active,
          created_at,
          updated_at
        `,
      )
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("app_config")
      .select("low_stock_percentage")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (ingredientsResult.error) throw ingredientsResult.error;
  if (configResult.error) throw configResult.error;

  return {
    ingredients: ingredientsResult.data ?? [],
    lowStockPercentage: Number(configResult.data?.low_stock_percentage) || 20,
  };
}

export default function InventarioPage() {
  const [ingredients, setIngredients] = useState([]);
  const [lowStockPercentage, setLowStockPercentage] = useState(20);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [search, setSearch] = useState("");

  const [form, setForm] = useState({
    name: "",
    unit: "g",
    purchaseQuantity: "",
    purchaseCost: "",
    minimumStock: "",
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await getInventoryData();

        if (active) {
          setIngredients(data.ingredients);
          setLowStockPercentage(data.lowStockPercentage);
        }
      } catch (error) {
        console.error(error);
        if (active) {
          await Swal.fire({
            icon: "error",
            title: "No se pudo cargar el inventario",
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

  const refreshInventory = async () => {
    const data = await getInventoryData();
    setIngredients(data.ingredients);
    setLowStockPercentage(data.lowStockPercentage);
  };

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return ingredients;

    return ingredients.filter((item) =>
      item.name.toLowerCase().includes(normalizedSearch),
    );
  }, [ingredients, search]);

  const summary = useMemo(
    () =>
      ingredients.reduce(
        (result, item) => {
          const stock = Number(item.current_stock) || 0;
          const minimum = Number(item.minimum_stock) || 0;
          const unitCost = Number(item.average_unit_cost) || 0;

          result.value += stock * unitCost;
          if (stock <= 0) result.outOfStock += 1;
          if (minimum > 0 && stock <= minimum) result.lowStock += 1;

          return result;
        },
        { value: 0, lowStock: 0, outOfStock: 0 },
      ),
    [ingredients],
  );

  const handleSubmit = async (event) => {
    event.preventDefault();

    const name = form.name.trim();
    const purchaseQuantity = Number(form.purchaseQuantity);
    const purchaseCost = Number(form.purchaseCost);
    const automaticMinimum =
      purchaseQuantity * (Number(lowStockPercentage) / 100);
    const minimumStock =
      form.minimumStock === "" ? automaticMinimum : Number(form.minimumStock);

    if (!name) {
      await Swal.fire({
        icon: "warning",
        title: "Nombre requerido",
        text: "Escribe el nombre del ingrediente.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    if (!Number.isFinite(purchaseQuantity) || purchaseQuantity <= 0) {
      await Swal.fire({
        icon: "warning",
        title: "Cantidad inválida",
        text: "La cantidad comprada debe ser mayor que cero.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    if (!Number.isFinite(purchaseCost) || purchaseCost < 0) {
      await Swal.fire({
        icon: "warning",
        title: "Costo inválido",
        text: "El costo total no puede ser negativo.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    if (!Number.isFinite(minimumStock) || minimumStock < 0) {
      await Swal.fire({
        icon: "warning",
        title: "Stock mínimo inválido",
        text: "El stock mínimo no puede ser negativo.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    try {
      setIsSubmitting(true);

      const { error } = await supabase.rpc("create_ingredient_with_stock", {
        p_name: name,
        p_unit: form.unit,
        p_quantity: purchaseQuantity,
        p_total_cost: purchaseCost,
        p_minimum_stock: minimumStock,
      });

      if (error) throw error;

      setForm({
        name: "",
        unit: "g",
        purchaseQuantity: "",
        purchaseCost: "",
        minimumStock: "",
      });

      await refreshInventory();

      await Swal.fire({
        icon: "success",
        title: "Ingrediente guardado",
        text: `${name} se agregó correctamente al inventario.`,
        timer: 1600,
        showConfirmButton: false,
      });
    } catch (error) {
      console.error(error);
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
        text: error.message,
        confirmButtonColor: "#8b5e3c",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = async (ingredient) => {
    const { count, error: countError } = await supabase
      .from("recipe_ingredients")
      .select("id", { count: "exact", head: true })
      .eq("ingredient_id", ingredient.id);

    if (countError) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo abrir la edición",
        text: countError.message,
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    const isUsedInRecipes = Number(count || 0) > 0;

    const result = await Swal.fire({
      title: `Editar ${ingredient.name}`,
      html: `
        <div style="text-align:left">
          <label for="edit-name" style="display:block;font-size:14px;font-weight:700;margin-bottom:6px;color:#44403c">
            Nombre
          </label>
          <input id="edit-name" class="swal2-input" value="${escapeAttribute(
            ingredient.name,
          )}" style="width:100%;margin:0 0 16px 0" />

          <label for="edit-unit" style="display:block;font-size:14px;font-weight:700;margin-bottom:6px;color:#44403c">
            Unidad base
          </label>
          <select id="edit-unit" class="swal2-select" style="width:100%;margin:0 0 16px 0" ${
            isUsedInRecipes ? "disabled" : ""
          }>
            <option value="g" ${ingredient.unit === "g" ? "selected" : ""}>Gramos (g)</option>
            <option value="ml" ${ingredient.unit === "ml" ? "selected" : ""}>Mililitros (ml)</option>
            <option value="pz" ${ingredient.unit === "pz" ? "selected" : ""}>Piezas (pz)</option>
          </select>
          ${
            isUsedInRecipes
              ? '<p style="margin:-8px 0 16px;font-size:12px;color:#78716c">La unidad no puede cambiarse porque este ingrediente ya se usa en una receta.</p>'
              : ""
          }

          <label for="edit-stock" style="display:block;font-size:14px;font-weight:700;margin-bottom:6px;color:#44403c">
            Stock actual (${ingredient.unit})
          </label>
          <input id="edit-stock" type="number" min="0" step="0.01" class="swal2-input" value="${Number(
            ingredient.current_stock,
          )}" style="width:100%;margin:0 0 16px 0" />

          <label for="edit-minimum" style="display:block;font-size:14px;font-weight:700;margin-bottom:6px;color:#44403c">
            Stock mínimo (${ingredient.unit})
          </label>
          <input id="edit-minimum" type="number" min="0" step="0.01" class="swal2-input" value="${Number(
            ingredient.minimum_stock,
          )}" style="width:100%;margin:0" />
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Guardar cambios",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#8b5e3c",
      cancelButtonColor: "#78716c",
      focusConfirm: false,
      preConfirm: () => {
        const name = document.getElementById("edit-name")?.value.trim();
        const unit = document.getElementById("edit-unit")?.value;
        const currentStock = Number(
          document.getElementById("edit-stock")?.value,
        );
        const minimumStock = Number(
          document.getElementById("edit-minimum")?.value,
        );

        if (!name) {
          Swal.showValidationMessage("El nombre es obligatorio.");
          return false;
        }

        if (!Number.isFinite(currentStock) || currentStock < 0) {
          Swal.showValidationMessage("El stock actual no puede ser negativo.");
          return false;
        }

        if (!Number.isFinite(minimumStock) || minimumStock < 0) {
          Swal.showValidationMessage("El stock mínimo no puede ser negativo.");
          return false;
        }

        return {
          name,
          unit: unit || ingredient.unit,
          currentStock,
          minimumStock,
        };
      },
    });

    if (!result.isConfirmed || !result.value) return;

    try {
      const { error } = await supabase.rpc("update_ingredient_details", {
        p_ingredient_id: ingredient.id,
        p_name: result.value.name,
        p_unit: result.value.unit,
        p_current_stock: result.value.currentStock,
        p_minimum_stock: result.value.minimumStock,
      });

      if (error) throw error;

      await refreshInventory();

      await Swal.fire({
        icon: "success",
        title: "Ingrediente actualizado",
        timer: 1400,
        showConfirmButton: false,
      });
    } catch (error) {
      console.error(error);
      await Swal.fire({
        icon: "error",
        title: "No se pudo editar",
        text: error.message,
        confirmButtonColor: "#8b5e3c",
      });
    }
  };

  const handleReplenish = async (ingredient) => {
    const result = await Swal.fire({
      title: `Reabastecer ${ingredient.name}`,
      html: `
        <div style="text-align:left">
          <p style="margin:0 0 18px;color:#78716c;font-size:14px">
            Stock actual: <strong>${quantity(ingredient.current_stock)} ${
              ingredient.unit
            }</strong>
          </p>

          <label for="replenish-quantity" style="display:block;font-size:14px;font-weight:700;margin-bottom:6px;color:#44403c">
            Cantidad comprada (${ingredient.unit})
          </label>
          <input id="replenish-quantity" type="number" min="0.01" step="0.01" class="swal2-input" placeholder="Ej. 1000" style="width:100%;margin:0 0 16px 0" />

          <label for="replenish-cost" style="display:block;font-size:14px;font-weight:700;margin-bottom:6px;color:#44403c">
            Precio total de la compra
          </label>
          <input id="replenish-cost" type="number" min="0" step="0.01" class="swal2-input" placeholder="Ej. 42.00" style="width:100%;margin:0" />
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Registrar compra",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#8b5e3c",
      cancelButtonColor: "#78716c",
      focusConfirm: false,
      preConfirm: () => {
        const purchasedQuantity = Number(
          document.getElementById("replenish-quantity")?.value,
        );
        const totalCost = Number(
          document.getElementById("replenish-cost")?.value,
        );

        if (!Number.isFinite(purchasedQuantity) || purchasedQuantity <= 0) {
          Swal.showValidationMessage("La cantidad debe ser mayor que cero.");
          return false;
        }

        if (!Number.isFinite(totalCost) || totalCost < 0) {
          Swal.showValidationMessage("El precio no puede ser negativo.");
          return false;
        }

        return { purchasedQuantity, totalCost };
      },
    });

    if (!result.isConfirmed || !result.value) return;

    try {
      Swal.fire({
        title: "Actualizando inventario",
        text: "Registrando la nueva compra...",
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
      });

      const { data, error } = await supabase.rpc("replenish_ingredient", {
        p_ingredient_id: ingredient.id,
        p_quantity: result.value.purchasedQuantity,
        p_total_cost: result.value.totalCost,
      });

      if (error) throw error;

      await refreshInventory();

      await Swal.fire({
        icon: "success",
        title: "Inventario actualizado",
        html: `Ahora tienes <strong>${quantity(data.stock_after)} ${
          ingredient.unit
        }</strong> de ${escapeHtml(ingredient.name)}.`,
        confirmButtonColor: "#8b5e3c",
      });
    } catch (error) {
      console.error(error);
      await Swal.fire({
        icon: "error",
        title: "No se pudo reabastecer",
        text: error.message,
        confirmButtonColor: "#8b5e3c",
      });
    }
  };

  const handleDelete = async (ingredient) => {
    const { count, error: countError } = await supabase
      .from("recipe_ingredients")
      .select("id", { count: "exact", head: true })
      .eq("ingredient_id", ingredient.id);

    if (countError) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo comprobar el ingrediente",
        text: countError.message,
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    const recipeCount = Number(count || 0);

    const result = await Swal.fire({
      icon: "warning",
      title: `¿Eliminar ${ingredient.name}?`,
      html:
        recipeCount > 0
          ? `<p>Este ingrediente se usa en <strong>${recipeCount} receta(s)</strong>.</p><p style="margin-top:10px">Se ocultará del inventario y esas recetas no podrán producirse hasta que cambies el ingrediente.</p>`
          : "El ingrediente dejará de aparecer en el inventario.",
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#b91c1c",
      cancelButtonColor: "#78716c",
      reverseButtons: true,
    });

    if (!result.isConfirmed) return;

    try {
      let deleteError = null;

      if (recipeCount > 0) {
        const { error } = await supabase
          .from("ingredients")
          .update({
            is_active: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", ingredient.id);

        deleteError = error;
      } else {
        const { error } = await supabase
          .from("ingredients")
          .delete()
          .eq("id", ingredient.id);

        deleteError = error;
      }

      if (deleteError) throw deleteError;

      await refreshInventory();

      await Swal.fire({
        icon: "success",
        title: "Ingrediente eliminado",
        text:
          recipeCount > 0
            ? `${ingredient.name} se ocultó para conservar las recetas existentes.`
            : `${ingredient.name} se eliminó definitivamente.`,
        timer: 1700,
        showConfirmButton: false,
      });
    } catch (error) {
      console.error(error);
      await Swal.fire({
        icon: "error",
        title: "No se pudo eliminar",
        text: error.message,
        confirmButtonColor: "#8b5e3c",
      });
    }
  };

  const getStockStatus = (item) => {
    const stock = Number(item.current_stock) || 0;
    const minimum = Number(item.minimum_stock) || 0;
    const preventiveLimit = minimum * (1 + lowStockPercentage / 100);

    if (stock <= 0) {
      return {
        label: "Agotado",
        classes: "bg-red-100 text-red-700",
      };
    }

    if (minimum > 0 && stock <= minimum) {
      return {
        label: "Stock bajo",
        classes: "bg-red-100 text-red-700",
      };
    }

    if (minimum > 0 && stock <= preventiveLimit) {
      return {
        label: "Cerca del mínimo",
        classes: "bg-amber-100 text-amber-800",
      };
    }

    return {
      label: "Disponible",
      classes: "bg-emerald-100 text-emerald-700",
    };
  };

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <div>
        <p className="text-sm font-black uppercase tracking-[.16em] text-orange-700">
          Inventario
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-stone-900">
          Insumos disponibles
        </h1>
        <p className="mt-2 text-stone-500">
          Registra compras, edita ingredientes y controla cuándo necesitan
          reabastecimiento.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Ingredientes" value={ingredients.length} />
        <SummaryCard label="Stock bajo" value={summary.lowStock} danger />
        <SummaryCard label="Agotados" value={summary.outOfStock} danger />
        <SummaryCard label="Valor aproximado" value={money(summary.value)} />
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="mb-6">
          <h2 className="text-xl font-black text-stone-900">
            Agregar ingrediente
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Captura la presentación comprada usando gramos, mililitros o piezas.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-6"
        >
          <label className="xl:col-span-2">
            <span className="mb-2 block text-sm font-bold text-stone-700">
              Nombre
            </span>
            <input
              value={form.name}
              onChange={(event) => updateForm("name", event.target.value)}
              required
              placeholder="Ej. Harina de trigo"
              className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
            />
          </label>

          <label>
            <span className="mb-2 block text-sm font-bold text-stone-700">
              Unidad base
            </span>
            <select
              value={form.unit}
              onChange={(event) => updateForm("unit", event.target.value)}
              className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
            >
              <option value="g">Gramos (g)</option>
              <option value="ml">Mililitros (ml)</option>
              <option value="pz">Piezas (pz)</option>
            </select>
          </label>

          <label>
            <span className="mb-2 block text-sm font-bold text-stone-700">
              Cantidad comprada
            </span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.purchaseQuantity}
              onChange={(event) =>
                updateForm("purchaseQuantity", event.target.value)
              }
              required
              placeholder="1000"
              className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
            />
          </label>

          <label>
            <span className="mb-2 block text-sm font-bold text-stone-700">
              Precio total
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.purchaseCost}
              onChange={(event) =>
                updateForm("purchaseCost", event.target.value)
              }
              required
              placeholder="45.00"
              className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
            />
          </label>

          <label>
            <span className="mb-2 block text-sm font-bold text-stone-700">
              Stock mínimo
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.minimumStock}
              onChange={(event) =>
                updateForm("minimumStock", event.target.value)
              }
              placeholder="Automático"
              className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
            />
          </label>

          <div className="flex items-end md:col-span-2 xl:col-span-6 xl:justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-[#8b5e3c] px-6 py-3 font-black text-white transition hover:bg-[#70472d] disabled:cursor-not-allowed disabled:opacity-60 xl:w-auto"
            >
              {isSubmitting ? "Guardando..." : "Guardar ingrediente"}
            </button>
          </div>
        </form>

        <p className="mt-4 text-xs leading-5 text-stone-400">
          Si dejas vacío el stock mínimo, se calculará con el porcentaje
          preventivo configurado actualmente: {lowStockPercentage}% de la compra
          inicial.
        </p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-stone-200 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-stone-900">
              Lista de ingredientes
            </h2>
            <p className="text-sm text-stone-500">
              {filtered.length} resultado(s)
            </p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar ingrediente..."
            className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100 sm:max-w-xs"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1160px] text-left">
            <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
              <tr>
                <th className="px-5 py-4">Ingrediente</th>
                <th className="px-5 py-4 text-right">Última compra</th>
                <th className="px-5 py-4 text-right">Último precio</th>
                <th className="px-5 py-4 text-right">Costo promedio</th>
                <th className="px-5 py-4 text-right">Stock actual</th>
                <th className="px-5 py-4 text-right">Stock mínimo</th>
                <th className="px-5 py-4 text-right">Acciones</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-12 text-center text-stone-500"
                  >
                    Cargando inventario...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-12 text-center text-stone-500"
                  >
                    No hay ingredientes para mostrar.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const status = getStockStatus(item);

                  return (
                    <tr key={item.id} className="hover:bg-orange-50/40">
                      <td className="px-5 py-4">
                        <p className="font-black text-stone-800">{item.name}</p>
                        <span className="mt-1 inline-block rounded-full bg-stone-100 px-2 py-1 text-xs font-bold text-stone-500">
                          {item.unit}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-right text-stone-600">
                        {quantity(item.purchase_quantity)} {item.unit}
                      </td>

                      <td className="px-5 py-4 text-right font-bold text-stone-700">
                        {money(item.purchase_cost)}
                      </td>

                      <td className="px-5 py-4 text-right text-stone-600">
                        {money(item.average_unit_cost, 4)} / {item.unit}
                      </td>

                      <td className="px-5 py-4 text-right">
                        <p className="font-black text-stone-800">
                          {quantity(item.current_stock)} {item.unit}
                        </p>
                        <span
                          className={`mt-1 inline-block rounded-full px-2.5 py-1 text-xs font-black ${status.classes}`}
                        >
                          {status.label}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-right text-stone-600">
                        {quantity(item.minimum_stock)} {item.unit}
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleEdit(item)}
                            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-black text-stone-700 transition hover:border-orange-300 hover:bg-orange-50"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReplenish(item)}
                            className="rounded-lg bg-[#8b5e3c] px-3 py-2 text-xs font-black text-white transition hover:bg-[#70472d]"
                          >
                            Reabastecer
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item)}
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 transition hover:bg-red-100"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value, danger = false }) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-stone-500">{label}</p>
      <p
        className={`mt-2 text-3xl font-black ${
          danger ? "text-red-600" : "text-stone-900"
        }`}
      >
        {value}
      </p>
    </article>
  );
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
