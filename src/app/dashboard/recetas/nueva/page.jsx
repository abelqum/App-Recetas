"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

async function getInitialRecipeData() {
  const [ingredientsResult, categoriesResult, configResult] = await Promise.all(
    [
      supabase
        .from("ingredients")
        .select(
          `
        id,
        name,
        unit,
        purchase_cost,
        purchase_quantity,
        average_unit_cost,
        current_stock
      `,
        )
        .eq("is_active", true)
        .order("name"),

      supabase.from("categories").select("id, name, description").order("name"),

      supabase
        .from("app_config")
        .select(
          "kwh_cost, electric_power_watts, oven_power_watts, gas_hourly_cost",
        )
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ],
  );

  if (ingredientsResult.error) throw ingredientsResult.error;
  if (categoriesResult.error) throw categoriesResult.error;
  if (configResult.error) throw configResult.error;

  const config = configResult.data ?? {};

  return {
    inventory: ingredientsResult.data ?? [],
    categories: categoriesResult.data ?? [],
    config: {
      kwhCost: Number(config.kwh_cost) || 0,
      electricPowerWatts:
        Number(config.electric_power_watts) ||
        Number(config.oven_power_watts) ||
        0,
      gasHourlyCost: Number(config.gas_hourly_cost) || 0,
    },
  };
}

function money(value) {
  return Number(value || 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getIngredientUnitCost(ingredient) {
  if (!ingredient) return 0;

  const averageCost = Number(ingredient.average_unit_cost);

  if (Number.isFinite(averageCost) && averageCost > 0) {
    return averageCost;
  }

  const purchaseQuantity = Number(ingredient.purchase_quantity) || 0;
  const purchaseCost = Number(ingredient.purchase_cost) || 0;

  return purchaseQuantity > 0 ? purchaseCost / purchaseQuantity : 0;
}

export default function NuevaRecetaPage() {
  const router = useRouter();

  const [inventory, setInventory] = useState([]);
  const [categories, setCategories] = useState([]);
  const [config, setConfig] = useState({
    kwhCost: 0,
    electricPowerWatts: 0,
    gasHourlyCost: 0,
  });

  const [recipeName, setRecipeName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [electricTimeMinutes, setElectricTimeMinutes] = useState("0");
  const [gasTimeMinutes, setGasTimeMinutes] = useState("0");
  const [laborCost, setLaborCost] = useState("");
  const [profitMarginPercent, setProfitMarginPercent] = useState("30");

  const [recipeIngredients, setRecipeIngredients] = useState([
    { ingredientId: "", quantityNeeded: "" },
  ]);

  const [steps, setSteps] = useState([{ description: "" }]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadInitialData() {
      try {
        const data = await getInitialRecipeData();

        if (!active) return;

        setInventory(data.inventory);
        setCategories(data.categories);
        setConfig(data.config);
      } catch (error) {
        console.error("Error al cargar datos:", error);

        if (active) {
          await Swal.fire({
            icon: "error",
            title: "No se pudo preparar la receta",
            text: error?.message || "Ocurrió un error al cargar los datos.",
            confirmButtonColor: "#8b5e3c",
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadInitialData();

    return () => {
      active = false;
    };
  }, []);

  const ingredientCosts = useMemo(() => {
    return recipeIngredients.map((row) => {
      const ingredient = inventory.find((item) => item.id === row.ingredientId);

      const quantityNeeded = Number(row.quantityNeeded) || 0;
      const unitCost = getIngredientUnitCost(ingredient);

      return {
        ingredient,
        quantityNeeded,
        cost: unitCost * quantityNeeded,
      };
    });
  }, [inventory, recipeIngredients]);

  const calculations = useMemo(() => {
    const ingredientTotal = ingredientCosts.reduce(
      (total, item) => total + item.cost,
      0,
    );

    const electricMinutes = Number(electricTimeMinutes) || 0;
    const gasMinutes = Number(gasTimeMinutes) || 0;

    const electricCost =
      (config.electricPowerWatts / 1000) *
      (electricMinutes / 60) *
      config.kwhCost;

    const gasCost = (gasMinutes / 60) * config.gasHourlyCost;
    const parsedLaborCost = Number(laborCost) || 0;
    const parsedProfitMargin = Number(profitMarginPercent) || 0;

    const totalCost =
      ingredientTotal + electricCost + gasCost + parsedLaborCost;

    const profitAmount = totalCost * (parsedProfitMargin / 100);
    const finalPrice = totalCost + profitAmount;

    return {
      ingredientTotal,
      electricCost,
      gasCost,
      laborCost: parsedLaborCost,
      profitPercent: parsedProfitMargin,
      totalCost,
      profitAmount,
      finalPrice,
    };
  }, [
    config,
    electricTimeMinutes,
    gasTimeMinutes,
    ingredientCosts,
    laborCost,
    profitMarginPercent,
  ]);

  const updateIngredientRow = (index, field, value) => {
    setRecipeIngredients((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  };

  const addIngredientRow = () => {
    setRecipeIngredients((current) => [
      ...current,
      { ingredientId: "", quantityNeeded: "" },
    ]);
  };

  const removeIngredientRow = (index) => {
    setRecipeIngredients((current) => {
      if (current.length === 1) {
        return [{ ingredientId: "", quantityNeeded: "" }];
      }

      return current.filter((_, rowIndex) => rowIndex !== index);
    });
  };

  const updateStep = (index, value) => {
    setSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index ? { description: value } : step,
      ),
    );
  };

  const addStep = () => {
    setSteps((current) => [...current, { description: "" }]);
  };

  const removeStep = (index) => {
    setSteps((current) => {
      if (current.length === 1) return [{ description: "" }];
      return current.filter((_, stepIndex) => stepIndex !== index);
    });
  };

  const moveStep = (index, direction) => {
    setSteps((current) => {
      const destination = index + direction;

      if (destination < 0 || destination >= current.length) {
        return current;
      }

      const copy = [...current];
      [copy[index], copy[destination]] = [copy[destination], copy[index]];
      return copy;
    });
  };

  const validateRecipe = async () => {
    if (!recipeName.trim()) {
      await Swal.fire({
        icon: "warning",
        title: "Nombre requerido",
        text: "Escribe el nombre de la receta.",
        confirmButtonColor: "#8b5e3c",
      });
      return false;
    }

    if (!categoryId) {
      await Swal.fire({
        icon: "warning",
        title: "Categoría requerida",
        text: "Selecciona la categoría de la receta.",
        confirmButtonColor: "#8b5e3c",
      });
      return false;
    }

    const normalizedIngredients = recipeIngredients.filter(
      (row) => row.ingredientId || String(row.quantityNeeded).trim(),
    );

    if (normalizedIngredients.length === 0) {
      await Swal.fire({
        icon: "warning",
        title: "Faltan ingredientes",
        text: "Agrega al menos un ingrediente.",
        confirmButtonColor: "#8b5e3c",
      });
      return false;
    }

    const invalidIngredient = normalizedIngredients.find(
      (row) =>
        !row.ingredientId ||
        !Number.isFinite(Number(row.quantityNeeded)) ||
        Number(row.quantityNeeded) <= 0,
    );

    if (invalidIngredient) {
      await Swal.fire({
        icon: "warning",
        title: "Ingrediente incompleto",
        text: "Selecciona cada ingrediente y escribe una cantidad mayor que cero.",
        confirmButtonColor: "#8b5e3c",
      });
      return false;
    }

    const ids = normalizedIngredients.map((row) => row.ingredientId);

    if (new Set(ids).size !== ids.length) {
      await Swal.fire({
        icon: "warning",
        title: "Ingrediente repetido",
        text: "Cada ingrediente debe aparecer una sola vez.",
        confirmButtonColor: "#8b5e3c",
      });
      return false;
    }

    const electricMinutes = Number(electricTimeMinutes || 0);
    const gasMinutes = Number(gasTimeMinutes || 0);

    if (!Number.isFinite(electricMinutes) || electricMinutes < 0) {
      await Swal.fire({
        icon: "warning",
        title: "Minutos de electricidad inválidos",
        text: "Los minutos de electricidad deben ser iguales o mayores que cero.",
        confirmButtonColor: "#8b5e3c",
      });
      return false;
    }

    if (!Number.isFinite(gasMinutes) || gasMinutes < 0) {
      await Swal.fire({
        icon: "warning",
        title: "Minutos de gas inválidos",
        text: "Los minutos de gas deben ser iguales o mayores que cero.",
        confirmButtonColor: "#8b5e3c",
      });
      return false;
    }

    if (
      !Number.isFinite(Number(laborCost || 0)) ||
      Number(laborCost || 0) < 0
    ) {
      await Swal.fire({
        icon: "warning",
        title: "Costo inválido",
        text: "La mano de obra no puede ser negativa.",
        confirmButtonColor: "#8b5e3c",
      });
      return false;
    }

    const profit = Number(profitMarginPercent || 0);

    if (!Number.isFinite(profit) || profit < 0 || profit > 999.99) {
      await Swal.fire({
        icon: "warning",
        title: "Utilidad inválida",
        text: "El porcentaje de utilidad debe estar entre 0 y 999.99.",
        confirmButtonColor: "#8b5e3c",
      });
      return false;
    }

    return true;
  };

  const handleSave = async () => {
    const valid = await validateRecipe();
    if (!valid) return;

    const ingredientsPayload = recipeIngredients
      .filter((row) => row.ingredientId)
      .map((row) => ({
        ingredient_id: row.ingredientId,
        quantity_needed: Number(row.quantityNeeded),
      }));

    const stepsPayload = steps
      .map((step) => ({ description: step.description.trim() }))
      .filter((step) => step.description);

    try {
      setIsSubmitting(true);

      const { data, error } = await supabase.rpc("create_recipe_with_details", {
        p_name: recipeName.trim(),
        p_category_id: categoryId,
        p_labor_cost: Number(laborCost || 0),
        p_profit_margin_percent: Number(profitMarginPercent || 0),
        p_electric_time_minutes: Math.trunc(Number(electricTimeMinutes || 0)),
        p_gas_time_minutes: Math.trunc(Number(gasTimeMinutes || 0)),
        p_ingredients: ingredientsPayload,
        p_steps: stepsPayload,
      });

      if (error) throw error;

      await Swal.fire({
        icon: "success",
        title: "Receta guardada",
        text: "La receta se registró correctamente.",
        timer: 1600,
        showConfirmButton: false,
      });

      router.push(`/dashboard/recetas/${data}`);
    } catch (error) {
      console.error("Error al guardar receta:", error);

      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
        text: error?.message || "Ocurrió un error al guardar la receta.",
        confirmButtonColor: "#8b5e3c",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white py-20 text-center text-stone-500 shadow-sm">
        Cargando ingredientes y categorías...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-7 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <button
            type="button"
            onClick={() => router.back()}
            className="mb-3 text-sm font-bold text-stone-500 transition hover:text-stone-900"
          >
            ← Volver
          </button>

          <p className="text-xs font-black uppercase tracking-[.16em] text-orange-700">
            Recetario
          </p>

          <h1 className="mt-1 text-3xl font-black tracking-tight text-stone-900">
            Nueva receta
          </h1>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={isSubmitting}
          className="rounded-xl bg-[#8b5e3c] px-6 py-3 text-sm font-black text-white shadow-md shadow-stone-900/10 transition hover:bg-[#70472d] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Guardando..." : "Guardar receta"}
        </button>
      </div>

      <div className="grid gap-7 xl:grid-cols-[1.45fr_0.75fr]">
        <div className="space-y-7">
          <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-stone-900">
              Información general
            </h2>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="md:col-span-2">
                <span className="mb-2 block text-sm font-bold text-stone-700">
                  Nombre de la receta
                </span>

                <input
                  type="text"
                  value={recipeName}
                  onChange={(event) => setRecipeName(event.target.value)}
                  placeholder="Ej. Brownies de chocolate"
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />
              </label>

              <label>
                <span className="mb-2 block text-sm font-bold text-stone-700">
                  Categoría
                </span>

                <select
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                >
                  <option value="">Selecciona una categoría</option>

                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>

                {categories.length === 0 && (
                  <p className="mt-2 text-xs text-amber-700">
                    Primero agrega categorías desde Configuración.
                  </p>
                )}
              </label>

              <label>
                <span className="mb-2 block text-sm font-bold text-stone-700">
                  Mano de obra
                </span>

                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-stone-400">
                    $
                  </span>

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={laborCost}
                    onChange={(event) => setLaborCost(event.target.value)}
                    placeholder="80.00"
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 py-3 pl-9 pr-4 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                  />
                </div>
              </label>

              <label>
                <span className="mb-2 block text-sm font-bold text-stone-700">
                  Minutos de electricidad
                </span>

                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={electricTimeMinutes}
                    onChange={(event) =>
                      setElectricTimeMinutes(event.target.value)
                    }
                    placeholder="0"
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 pr-16 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                  />

                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-400">
                    min
                  </span>
                </div>

                <p className="mt-2 text-xs leading-5 text-stone-500">
                  Suma el tiempo de horno eléctrico, batidora u otros equipos.
                  Déjalo en 0 cuando no se utilicen.
                </p>
              </label>

              <label>
                <span className="mb-2 block text-sm font-bold text-stone-700">
                  Minutos de gas
                </span>

                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={gasTimeMinutes}
                    onChange={(event) => setGasTimeMinutes(event.target.value)}
                    placeholder="0"
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 pr-16 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                  />

                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-400">
                    min
                  </span>
                </div>

                <p className="mt-2 text-xs leading-5 text-stone-500">
                  Suma el tiempo de horno o estufa de gas. Déjalo en 0 cuando no
                  se utilicen.
                </p>
              </label>

              <label className="md:col-span-2 md:max-w-[calc(50%-0.5rem)]">
                <span className="mb-2 block text-sm font-bold text-stone-700">
                  Porcentaje de utilidad
                </span>

                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="999.99"
                    step="0.01"
                    value={profitMarginPercent}
                    onChange={(event) =>
                      setProfitMarginPercent(event.target.value)
                    }
                    placeholder="30"
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 pr-12 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                  />

                  <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-stone-400">
                    %
                  </span>
                </div>

                <p className="mt-2 text-xs text-stone-500">
                  Se aplica sobre el costo total de la receta.
                </p>
              </label>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-stone-100 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-black text-stone-900">
                  Ingredientes
                </h2>

                <p className="mt-1 text-sm text-stone-500">
                  Selecciona el insumo y la cantidad utilizada.
                </p>
              </div>

              <button
                type="button"
                onClick={addIngredientRow}
                className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm font-black text-orange-800 transition hover:bg-orange-100"
              >
                + Agregar fila
              </button>
            </div>

            <div className="space-y-4 p-6">
              {recipeIngredients.map((row, index) => {
                const costData = ingredientCosts[index];

                return (
                  <div
                    key={`ingredient-row-${index}`}
                    className="grid gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 md:grid-cols-[1.4fr_0.75fr_0.6fr_auto] md:items-end"
                  >
                    <label>
                      <span className="mb-2 block text-xs font-black uppercase tracking-wider text-stone-500">
                        Insumo
                      </span>

                      <select
                        value={row.ingredientId}
                        onChange={(event) =>
                          updateIngredientRow(
                            index,
                            "ingredientId",
                            event.target.value,
                          )
                        }
                        className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                      >
                        <option value="">Selecciona un ingrediente</option>

                        {inventory.map((ingredient) => (
                          <option key={ingredient.id} value={ingredient.id}>
                            {ingredient.name} · {ingredient.current_stock}{" "}
                            {ingredient.unit}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span className="mb-2 block text-xs font-black uppercase tracking-wider text-stone-500">
                        Cantidad
                      </span>

                      <div className="relative">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={row.quantityNeeded}
                          onChange={(event) =>
                            updateIngredientRow(
                              index,
                              "quantityNeeded",
                              event.target.value,
                            )
                          }
                          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 pr-14 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                        />

                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-stone-400">
                          {costData?.ingredient?.unit || "—"}
                        </span>
                      </div>
                    </label>

                    <div>
                      <p className="mb-2 text-xs font-black uppercase tracking-wider text-stone-500">
                        Costo
                      </p>

                      <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-right font-black text-stone-800">
                        {money(costData?.cost)}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeIngredientRow(index)}
                      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700 transition hover:bg-red-100"
                    >
                      Quitar
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-stone-100 p-6">
              <div>
                <h2 className="text-xl font-black text-stone-900">
                  Preparación
                </h2>

                <p className="mt-1 text-sm text-stone-500">
                  Registra los pasos en el orden correcto.
                </p>
              </div>

              <button
                type="button"
                onClick={addStep}
                className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm font-black text-orange-800 transition hover:bg-orange-100"
              >
                + Agregar paso
              </button>
            </div>

            <div className="space-y-4 p-6">
              {steps.map((step, index) => (
                <div
                  key={`step-${index}`}
                  className="grid gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-start"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 font-black text-orange-800">
                    {index + 1}
                  </span>

                  <textarea
                    rows={3}
                    value={step.description}
                    onChange={(event) => updateStep(index, event.target.value)}
                    placeholder={`Describe el paso ${index + 1}`}
                    className="w-full resize-y rounded-xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                  />

                  <div className="flex gap-2 sm:flex-col">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveStep(index, -1)}
                      className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-black text-stone-700 disabled:opacity-40"
                    >
                      ↑
                    </button>

                    <button
                      type="button"
                      disabled={index === steps.length - 1}
                      onClick={() => moveStep(index, 1)}
                      className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-black text-stone-700 disabled:opacity-40"
                    >
                      ↓
                    </button>

                    <button
                      type="button"
                      onClick={() => removeStep(index)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside>
          <div className="sticky top-28 overflow-hidden rounded-2xl bg-[#3b2a20] text-white shadow-xl">
            <div className="border-b border-white/10 p-6">
              <p className="text-xs font-black uppercase tracking-[.16em] text-orange-200">
                Cálculo actual
              </p>

              <h2 className="mt-2 text-xl font-black">Costo de la receta</h2>
            </div>

            <div className="space-y-4 p-6 text-sm">
              <CostRow
                label="Ingredientes"
                value={money(calculations.ingredientTotal)}
              />

              <CostRow
                label="Electricidad"
                value={money(calculations.electricCost)}
              />

              <CostRow label="Gas" value={money(calculations.gasCost)} />

              <CostRow
                label="Mano de obra"
                value={money(calculations.laborCost)}
              />

              <div className="border-t border-white/15 pt-4">
                <CostRow
                  label="Costo total"
                  value={money(calculations.totalCost)}
                />

                <div className="mt-3">
                  <CostRow
                    label={`Utilidad (${calculations.profitPercent}%)`}
                    value={money(calculations.profitAmount)}
                  />
                </div>
              </div>

              <div className="rounded-xl bg-orange-100 p-4 text-[#3b2a20]">
                <p className="text-xs font-black uppercase tracking-[.14em] text-orange-800">
                  Precio final
                </p>

                <p className="mt-2 text-3xl font-black">
                  {money(calculations.finalPrice)}
                </p>
              </div>

              <div className="rounded-xl bg-white/10 p-4 text-xs leading-6 text-stone-200">
                <p>
                  Electricidad: potencia configurada × minutos eléctricos ×
                  costo por kWh.
                </p>
                <p className="mt-2">
                  Gas: minutos de gas × costo configurado por hora.
                </p>
                <p className="mt-2 font-bold text-orange-100">
                  Cuando un consumo no aplique, déjalo en 0.
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CostRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-stone-300">{label}</span>
      <span className="font-black text-white">{value}</span>
    </div>
  );
}
