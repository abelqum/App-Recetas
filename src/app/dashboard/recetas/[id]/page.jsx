"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { jsPDF } from "jspdf";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

async function getRecipeDetail(recipeId) {
  const [
    configResult,
    recipeResult,
    relationsResult,
    stepsResult,
    inventoryResult,
    categoriesResult,
  ] = await Promise.all([
    supabase
      .from("app_config")
      .select(
        "business_name, logo_url, kwh_cost, electric_power_watts, oven_power_watts, gas_hourly_cost",
      )
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

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
        updated_at,
        categories (
          id,
          name,
          description
        )
      `,
      )
      .eq("id", recipeId)
      .single(),

    supabase
      .from("recipe_ingredients")
      .select(
        `
        id,
        ingredient_id,
        quantity_needed,
        ingredients (
          id,
          name,
          unit,
          purchase_cost,
          purchase_quantity,
          average_unit_cost,
          current_stock,
          minimum_stock,
          is_active
        )
      `,
      )
      .eq("recipe_id", recipeId)
      .order("id"),

    supabase
      .from("recipe_steps")
      .select("id, step_number, description")
      .eq("recipe_id", recipeId)
      .order("step_number", { ascending: true }),

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
        current_stock,
        minimum_stock,
        is_active
      `,
      )
      .eq("is_active", true)
      .order("name"),

    supabase.from("categories").select("id, name, description").order("name"),
  ]);

  if (configResult.error) throw configResult.error;
  if (recipeResult.error) throw recipeResult.error;
  if (relationsResult.error) throw relationsResult.error;
  if (stepsResult.error) throw stepsResult.error;
  if (inventoryResult.error) throw inventoryResult.error;
  if (categoriesResult.error) throw categoriesResult.error;

  const relations = relationsResult.data ?? [];
  const inventoryMap = new Map(
    (inventoryResult.data ?? []).map((ingredient) => [
      ingredient.id,
      ingredient,
    ]),
  );

  relations.forEach((relation) => {
    const ingredient = getRelatedObject(relation.ingredients);
    if (ingredient && !inventoryMap.has(ingredient.id)) {
      inventoryMap.set(ingredient.id, ingredient);
    }
  });

  const mergedInventory = Array.from(inventoryMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "es"),
  );

  return {
    config: configResult.data ?? {
      business_name: "Mi negocio",
      logo_url: "",
      kwh_cost: 0,
      electric_power_watts: 0,
      oven_power_watts: 0,
      gas_hourly_cost: 0,
    },
    recipe: recipeResult.data,
    relations,
    steps: stepsResult.data ?? [],
    inventory: mergedInventory,
    categories: categoriesResult.data ?? [],
  };
}

function getRelatedObject(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function money(value, decimals = 2) {
  return Number(value || 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function quantity(value) {
  return Number(value || 0).toLocaleString("es-MX", {
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function imageUrlToDataUrl(url) {
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const blob = await response.blob();

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export default function DetalleRecetaPage() {
  const params = useParams();
  const router = useRouter();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [config, setConfig] = useState(null);
  const [recipe, setRecipe] = useState(null);
  const [relations, setRelations] = useState([]);
  const [steps, setSteps] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [categories, setCategories] = useState([]);

  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isProducing, setIsProducing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [draftName, setDraftName] = useState("");
  const [draftCategoryId, setDraftCategoryId] = useState("");
  const [draftElectricTime, setDraftElectricTime] = useState("");
  const [draftGasTime, setDraftGasTime] = useState("");
  const [draftLaborCost, setDraftLaborCost] = useState("");
  const [draftProfitMargin, setDraftProfitMargin] = useState("30");
  const [draftIngredients, setDraftIngredients] = useState([]);
  const [draftSteps, setDraftSteps] = useState([]);

  useEffect(() => {
    if (!id) return;

    let active = true;

    async function loadRecipe() {
      try {
        const data = await getRecipeDetail(id);

        if (active) {
          setConfig(data.config);
          setRecipe(data.recipe);
          setRelations(data.relations);
          setSteps(data.steps);
          setInventory(data.inventory);
          setCategories(data.categories);
        }
      } catch (error) {
        console.error("Error al cargar receta:", error);

        if (active) {
          await Swal.fire({
            icon: "error",
            title: "No se pudo cargar la receta",
            text: error.message,
            confirmButtonColor: "#8b5e3c",
          });
          router.replace("/dashboard/recetas");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadRecipe();

    return () => {
      active = false;
    };
  }, [id, router]);

  const refreshRecipe = async () => {
    const data = await getRecipeDetail(id);
    setConfig(data.config);
    setRecipe(data.recipe);
    setRelations(data.relations);
    setSteps(data.steps);
    setInventory(data.inventory);
    setCategories(data.categories);
  };

  const calculations = useMemo(() => {
    if (!recipe) {
      return {
        ingredientCost: 0,
        electricCost: 0,
        gasCost: 0,
        laborCost: 0,
        totalCost: 0,
        profitPercent: 0,
        profitAmount: 0,
        finalPrice: 0,
      };
    }

    const ingredientCost = relations.reduce((total, relation) => {
      const ingredient = getRelatedObject(relation.ingredients);
      return (
        total +
        getIngredientUnitCost(ingredient) *
          Number(relation.quantity_needed || 0)
      );
    }, 0);

    const electricPower =
      Number(config?.electric_power_watts) ||
      Number(config?.oven_power_watts) ||
      0;

    const electricCost =
      (electricPower / 1000) *
      (Number(recipe.electric_time_minutes || 0) / 60) *
      Number(config?.kwh_cost || 0);

    const gasCost =
      (Number(recipe.gas_time_minutes || 0) / 60) *
      Number(config?.gas_hourly_cost || 0);

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
  }, [config, recipe, relations]);

  const draftCalculations = useMemo(() => {
    const ingredientCost = draftIngredients.reduce((total, row) => {
      const ingredient = inventory.find((item) => item.id === row.ingredientId);
      return (
        total +
        getIngredientUnitCost(ingredient) * Number(row.quantityNeeded || 0)
      );
    }, 0);

    const electricPower =
      Number(config?.electric_power_watts) ||
      Number(config?.oven_power_watts) ||
      0;

    const electricCost =
      (electricPower / 1000) *
      (Number(draftElectricTime || 0) / 60) *
      Number(config?.kwh_cost || 0);

    const gasCost =
      (Number(draftGasTime || 0) / 60) * Number(config?.gas_hourly_cost || 0);

    const laborCost = Number(draftLaborCost || 0);
    const totalCost = ingredientCost + electricCost + gasCost + laborCost;
    const profitPercent = Number(draftProfitMargin || 0);
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
  }, [
    config,
    draftElectricTime,
    draftGasTime,
    draftIngredients,
    draftLaborCost,
    draftProfitMargin,
    inventory,
  ]);

  const startEditing = () => {
    setDraftName(recipe.name ?? "");
    setDraftCategoryId(recipe.category_id ?? "");
    setDraftElectricTime(String(recipe.electric_time_minutes ?? 0));
    setDraftGasTime(String(recipe.gas_time_minutes ?? 0));
    setDraftLaborCost(String(recipe.labor_cost ?? 0));
    setDraftProfitMargin(String(recipe.profit_margin_percent ?? 0));
    setDraftIngredients(
      relations.map((relation) => ({
        ingredientId: relation.ingredient_id,
        quantityNeeded: String(relation.quantity_needed ?? ""),
      })),
    );
    setDraftSteps(
      steps.length > 0
        ? steps.map((step) => ({ description: step.description ?? "" }))
        : [{ description: "" }],
    );
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const updateDraftIngredient = (index, field, value) => {
    setDraftIngredients((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  };

  const addDraftIngredient = () => {
    setDraftIngredients((current) => [
      ...current,
      { ingredientId: "", quantityNeeded: "" },
    ]);
  };

  const removeDraftIngredient = (index) => {
    setDraftIngredients((current) => {
      if (current.length === 1) {
        return [{ ingredientId: "", quantityNeeded: "" }];
      }
      return current.filter((_, rowIndex) => rowIndex !== index);
    });
  };

  const updateDraftStep = (index, value) => {
    setDraftSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index ? { description: value } : step,
      ),
    );
  };

  const addDraftStep = () => {
    setDraftSteps((current) => [...current, { description: "" }]);
  };

  const removeDraftStep = (index) => {
    setDraftSteps((current) => {
      if (current.length === 1) return [{ description: "" }];
      return current.filter((_, stepIndex) => stepIndex !== index);
    });
  };

  const moveDraftStep = (index, direction) => {
    setDraftSteps((current) => {
      const destination = index + direction;
      if (destination < 0 || destination >= current.length) return current;

      const copy = [...current];
      [copy[index], copy[destination]] = [copy[destination], copy[index]];
      return copy;
    });
  };

  const handleSaveChanges = async () => {
    const normalizedIngredients = draftIngredients.filter(
      (row) => row.ingredientId || String(row.quantityNeeded).trim(),
    );

    if (!draftName.trim()) {
      await Swal.fire({
        icon: "warning",
        title: "Nombre requerido",
        text: "Escribe el nombre de la receta.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    if (!draftCategoryId) {
      await Swal.fire({
        icon: "warning",
        title: "Categoría requerida",
        text: "Selecciona una categoría para la receta.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    if (normalizedIngredients.length === 0) {
      await Swal.fire({
        icon: "warning",
        title: "Faltan ingredientes",
        text: "La receta debe contener al menos un ingrediente.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    const invalidRow = normalizedIngredients.find(
      (row) =>
        !row.ingredientId ||
        !Number.isFinite(Number(row.quantityNeeded)) ||
        Number(row.quantityNeeded) <= 0,
    );

    if (invalidRow) {
      await Swal.fire({
        icon: "warning",
        title: "Ingrediente incompleto",
        text: "Selecciona cada ingrediente y escribe una cantidad mayor que cero.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    const ingredientIds = normalizedIngredients.map((row) => row.ingredientId);

    if (new Set(ingredientIds).size !== ingredientIds.length) {
      await Swal.fire({
        icon: "warning",
        title: "Ingrediente repetido",
        text: "Cada ingrediente debe aparecer una sola vez.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    if (
      !Number.isFinite(Number(draftElectricTime || 0)) ||
      Number(draftElectricTime || 0) < 0
    ) {
      await Swal.fire({
        icon: "warning",
        title: "Minutos eléctricos inválidos",
        text: "Los minutos de electricidad no pueden ser negativos.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    if (
      !Number.isFinite(Number(draftGasTime || 0)) ||
      Number(draftGasTime || 0) < 0
    ) {
      await Swal.fire({
        icon: "warning",
        title: "Minutos de gas inválidos",
        text: "Los minutos de gas no pueden ser negativos.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    if (
      !Number.isFinite(Number(draftLaborCost || 0)) ||
      Number(draftLaborCost || 0) < 0
    ) {
      await Swal.fire({
        icon: "warning",
        title: "Costo inválido",
        text: "La mano de obra no puede ser negativa.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    if (
      !Number.isFinite(Number(draftProfitMargin || 0)) ||
      Number(draftProfitMargin || 0) < 0 ||
      Number(draftProfitMargin || 0) > 999.99
    ) {
      await Swal.fire({
        icon: "warning",
        title: "Utilidad inválida",
        text: "El porcentaje de utilidad debe estar entre 0 y 999.99.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    const confirmation = await Swal.fire({
      icon: "question",
      title: "¿Guardar cambios?",
      text: "Se actualizarán la categoría, los ingredientes, las cantidades y los pasos de la receta.",
      showCancelButton: true,
      confirmButtonText: "Sí, guardar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#8b5e3c",
      cancelButtonColor: "#78716c",
      reverseButtons: true,
    });

    if (!confirmation.isConfirmed) return;

    try {
      setIsSaving(true);

      const { error } = await supabase.rpc("update_recipe_with_details", {
        p_recipe_id: recipe.id,
        p_name: draftName.trim(),
        p_category_id: draftCategoryId,
        p_labor_cost: Number(draftLaborCost || 0),
        p_profit_margin_percent: Number(draftProfitMargin || 0),
        p_electric_time_minutes: Math.trunc(Number(draftElectricTime || 0)),
        p_gas_time_minutes: Math.trunc(Number(draftGasTime || 0)),
        p_ingredients: normalizedIngredients.map((row) => ({
          ingredient_id: row.ingredientId,
          quantity_needed: Number(row.quantityNeeded),
        })),
        p_steps: draftSteps
          .map((step) => ({ description: step.description.trim() }))
          .filter((step) => step.description),
      });

      if (error) throw error;

      await refreshRecipe();
      setIsEditing(false);

      await Swal.fire({
        icon: "success",
        title: "Receta actualizada",
        text: "Los cambios se guardaron correctamente.",
        timer: 1600,
        showConfirmButton: false,
      });
    } catch (error) {
      console.error("Error al editar receta:", error);
      await Swal.fire({
        icon: "error",
        title: "No se pudieron guardar los cambios",
        text: error.message,
        confirmButtonColor: "#8b5e3c",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleProduce = async () => {
    const result = await Swal.fire({
      icon: "question",
      title: `Producir ${recipe.name}`,
      text: "Indica cuántos lotes vas a preparar.",
      input: "number",
      inputValue: 1,
      inputAttributes: {
        min: "1",
        step: "1",
      },
      showCancelButton: true,
      confirmButtonText: "Continuar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#8b5e3c",
      inputValidator: (value) => {
        const batches = Number(value);
        if (!Number.isInteger(batches) || batches <= 0) {
          return "Escribe una cantidad entera mayor que cero.";
        }
        return undefined;
      },
    });

    if (!result.isConfirmed) return;

    const batches = Number(result.value);
    const requirements = relations.map((relation) => {
      const ingredient = getRelatedObject(relation.ingredients);
      const required = Number(relation.quantity_needed || 0) * batches;
      const available = Number(ingredient?.current_stock || 0);

      return {
        ingredient,
        required,
        available,
        sufficient: Boolean(ingredient?.is_active) && available >= required,
      };
    });

    const insufficient = requirements.filter((item) => !item.sufficient);

    if (insufficient.length > 0) {
      await Swal.fire({
        icon: "error",
        title: "Inventario insuficiente",
        html: `
          <p style="margin-bottom:12px">No se puede producir ${batches} lote(s).</p>
          <ul style="margin:0;padding:0;list-style:none">
            ${insufficient
              .map(
                (item) => `
                  <li style="padding:10px 0;border-bottom:1px solid #e7e5e4;text-align:left">
                    <strong>${escapeHtml(item.ingredient?.name || "Ingrediente eliminado")}</strong><br>
                    Necesario: ${quantity(item.required)} ${escapeHtml(item.ingredient?.unit || "")} ·
                    Disponible: ${quantity(item.available)} ${escapeHtml(item.ingredient?.unit || "")}
                  </li>
                `,
              )
              .join("")}
          </ul>
        `,
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    const confirmation = await Swal.fire({
      icon: "warning",
      title: "Confirmar producción",
      html: `
        <p>Se descontarán del inventario:</p>
        <ul style="margin:14px 0 0;padding:0;list-style:none">
          ${requirements
            .map(
              (item) => `
                <li style="display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid #e7e5e4">
                  <span>${escapeHtml(item.ingredient.name)}</span>
                  <strong>${quantity(item.required)} ${escapeHtml(item.ingredient.unit)}</strong>
                </li>
              `,
            )
            .join("")}
        </ul>
      `,
      showCancelButton: true,
      confirmButtonText: "Sí, producir",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#8b5e3c",
      cancelButtonColor: "#78716c",
      reverseButtons: true,
    });

    if (!confirmation.isConfirmed) return;

    try {
      setIsProducing(true);

      Swal.fire({
        title: "Registrando producción",
        text: "Descontando ingredientes del inventario...",
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
      });

      const { data, error } = await supabase.rpc("produce_recipe", {
        p_recipe_id: recipe.id,
        p_batches: batches,
      });

      if (error) throw error;

      await refreshRecipe();

      const lowStock = Array.isArray(data?.low_stock) ? data.low_stock : [];

      await Swal.fire({
        icon: "success",
        title: "Producción registrada",
        html: `
          <p>Se registraron <strong>${batches} lote(s)</strong>.</p>
          <p style="margin-top:10px">Costo total: <strong>${money(data?.production_cost)}</strong></p>
          <p style="margin-top:6px">Precio final del lote: <strong>${money(data?.final_price)}</strong></p>
          ${
            lowStock.length > 0
              ? `
                <div style="margin-top:16px;padding:14px;border-radius:12px;background:#fff7ed;text-align:left;color:#9a3412">
                  <strong>Ingredientes con stock bajo:</strong>
                  <ul style="margin:8px 0 0;padding-left:20px">
                    ${lowStock
                      .map(
                        (item) =>
                          `<li>${escapeHtml(item.name)}: ${quantity(item.current_stock)} ${escapeHtml(item.unit)}</li>`,
                      )
                      .join("")}
                  </ul>
                </div>
              `
              : ""
          }
        `,
        confirmButtonColor: "#8b5e3c",
      });
    } catch (error) {
      console.error("Error al producir:", error);
      await Swal.fire({
        icon: "error",
        title: "No se pudo producir",
        text: error.message,
        confirmButtonColor: "#8b5e3c",
      });
    } finally {
      setIsProducing(false);
    }
  };

  const handleExportPdf = async () => {
    try {
      setIsExporting(true);

      Swal.fire({
        title: "Generando PDF",
        text: "Preparando la receta...",
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
      });

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 18;
      let y = 18;

      const logoData = await imageUrlToDataUrl(config?.logo_url);

      if (logoData) {
        try {
          const format = logoData.startsWith("data:image/jpeg")
            ? "JPEG"
            : logoData.startsWith("data:image/webp")
              ? "WEBP"
              : "PNG";
          pdf.addImage(logoData, format, margin, 10, 25, 25, undefined, "FAST");
        } catch {
          // El PDF continúa aunque el logo no sea compatible.
        }
      }

      pdf.setTextColor(59, 42, 32);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(18);
      pdf.text(
        config?.business_name || "Mi negocio",
        logoData ? 48 : margin,
        19,
      );

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(120, 113, 108);
      pdf.text("Recetario y control de costos", logoData ? 48 : margin, 26);

      y = 43;
      pdf.setDrawColor(139, 94, 60);
      pdf.setLineWidth(0.8);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 12;

      const category = getRelatedObject(recipe.categories);

      pdf.setTextColor(41, 37, 36);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(21);
      pdf.text(recipe.name, margin, y);
      y += 8;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(87, 83, 78);
      pdf.text(`Categoría: ${category?.name || "Sin categoría"}`, margin, y);
      y += 6;
      pdf.text(
        `Electricidad: ${quantity(recipe.electric_time_minutes)} minutos`,
        margin,
        y,
      );
      y += 6;
      pdf.text(`Gas: ${quantity(recipe.gas_time_minutes)} minutos`, margin, y);
      y += 12;

      const ensureSpace = (needed = 20) => {
        if (y + needed > pageHeight - 18) {
          pdf.addPage();
          y = 20;
        }
      };

      pdf.setTextColor(41, 37, 36);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(14);
      pdf.text("Ingredientes", margin, y);
      y += 8;

      relations.forEach((relation) => {
        ensureSpace(8);
        const ingredient = getRelatedObject(relation.ingredients);
        if (!ingredient) return;

        const itemCost =
          getIngredientUnitCost(ingredient) *
          Number(relation.quantity_needed || 0);

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(10);
        pdf.setTextColor(68, 64, 60);
        pdf.text(
          `• ${quantity(relation.quantity_needed)} ${ingredient.unit} de ${ingredient.name}`,
          margin + 2,
          y,
        );
        pdf.text(money(itemCost), pageWidth - margin, y, { align: "right" });
        y += 7;
      });

      y += 5;
      ensureSpace(18);
      pdf.setTextColor(41, 37, 36);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(14);
      pdf.text("Preparación", margin, y);
      y += 8;

      if (steps.length === 0) {
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(10);
        pdf.text("Sin pasos registrados.", margin, y);
        y += 7;
      } else {
        steps.forEach((step) => {
          const lines = pdf.splitTextToSize(
            `${step.step_number}. ${step.description}`,
            pageWidth - margin * 2,
          );
          ensureSpace(lines.length * 6 + 4);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(10);
          pdf.setTextColor(68, 64, 60);
          pdf.text(lines, margin, y);
          y += lines.length * 6 + 3;
        });
      }

      y += 5;
      ensureSpace(65);
      pdf.setFillColor(247, 245, 242);
      pdf.roundedRect(margin, y, pageWidth - margin * 2, 59, 3, 3, "F");
      y += 8;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.setTextColor(59, 42, 32);
      pdf.text("Desglose de costos", margin + 5, y);
      y += 8;

      const rows = [
        ["Ingredientes", money(calculations.ingredientCost)],
        ["Electricidad", money(calculations.electricCost)],
        ["Gas", money(calculations.gasCost)],
        ["Mano de obra", money(calculations.laborCost)],
        ["Costo total", money(calculations.totalCost)],
        [
          `Utilidad (${quantity(calculations.profitPercent)}%)`,
          money(calculations.profitAmount),
        ],
        ["Precio final", money(calculations.finalPrice)],
      ];

      rows.forEach(([label, value], index) => {
        pdf.setFont("helvetica", index === rows.length - 1 ? "bold" : "normal");
        pdf.setFontSize(index === rows.length - 1 ? 11 : 10);
        pdf.setTextColor(68, 64, 60);
        pdf.text(label, margin + 5, y);
        pdf.text(value, pageWidth - margin - 5, y, { align: "right" });
        y += 7;
      });

      const safeName = recipe.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();

      pdf.save(`${safeName || "receta"}.pdf`);
      Swal.close();
    } catch (error) {
      console.error("Error al generar PDF:", error);
      await Swal.fire({
        icon: "error",
        title: "No se pudo generar el PDF",
        text: error.message,
        confirmButtonColor: "#8b5e3c",
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white py-20 text-center text-stone-500 shadow-sm">
        Cargando receta...
      </div>
    );
  }

  if (!recipe) return null;

  const category = getRelatedObject(recipe.categories);

  return (
    <div className="mx-auto max-w-7xl space-y-7 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => router.push("/dashboard/recetas")}
          className="w-fit text-sm font-bold text-stone-500 transition hover:text-stone-900"
        >
          ← Volver a recetas
        </button>

        <div className="flex flex-wrap gap-2">
          {!isEditing ? (
            <>
              <button
                type="button"
                onClick={startEditing}
                className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-black text-stone-700 transition hover:bg-orange-50"
              >
                Editar receta
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={isExporting}
                className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-black text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
              >
                {isExporting ? "Generando..." : "Descargar PDF"}
              </button>
              <button
                type="button"
                onClick={handleProduce}
                disabled={isProducing || relations.length === 0}
                className="rounded-xl bg-[#8b5e3c] px-5 py-2.5 text-sm font-black text-white transition hover:bg-[#70472d] disabled:opacity-60"
              >
                {isProducing ? "Produciendo..." : "Producir receta"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={cancelEditing}
                disabled={isSaving}
                className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-black text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveChanges}
                disabled={isSaving}
                className="rounded-xl bg-[#8b5e3c] px-5 py-2.5 text-sm font-black text-white transition hover:bg-[#70472d] disabled:opacity-60"
              >
                {isSaving ? "Guardando..." : "Guardar cambios"}
              </button>
            </>
          )}
        </div>
      </div>

      {!isEditing ? (
        <RecipeView
          recipe={recipe}
          category={category}
          relations={relations}
          steps={steps}
          calculations={calculations}
        />
      ) : (
        <RecipeEditor
          categories={categories}
          inventory={inventory}
          name={draftName}
          setName={setDraftName}
          categoryId={draftCategoryId}
          setCategoryId={setDraftCategoryId}
          electricTime={draftElectricTime}
          setElectricTime={setDraftElectricTime}
          gasTime={draftGasTime}
          setGasTime={setDraftGasTime}
          laborCost={draftLaborCost}
          setLaborCost={setDraftLaborCost}
          profitMargin={draftProfitMargin}
          setProfitMargin={setDraftProfitMargin}
          ingredients={draftIngredients}
          updateIngredient={updateDraftIngredient}
          addIngredient={addDraftIngredient}
          removeIngredient={removeDraftIngredient}
          steps={draftSteps}
          updateStep={updateDraftStep}
          addStep={addDraftStep}
          removeStep={removeDraftStep}
          moveStep={moveDraftStep}
          calculations={draftCalculations}
        />
      )}
    </div>
  );
}

function RecipeView({ recipe, category, relations, steps, calculations }) {
  return (
    <>
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#3b2a20] to-[#6f4a32] p-7 text-white shadow-xl sm:p-9">
        <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-black text-orange-100">
          {category?.name || "Sin categoría"}
        </span>
        <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
          {recipe.name}
        </h1>
        <div className="mt-6 flex flex-wrap gap-3 text-sm font-bold text-stone-100">
          <span className="rounded-full bg-white/10 px-4 py-2">
            ⚡ {quantity(recipe.electric_time_minutes)} min eléctricos
          </span>
          <span className="rounded-full bg-white/10 px-4 py-2">
            🔥 {quantity(recipe.gas_time_minutes)} min de gas
          </span>
          <span className="rounded-full bg-white/10 px-4 py-2">
            {relations.length} ingrediente(s)
          </span>
          <span className="rounded-full bg-white/10 px-4 py-2">
            {quantity(recipe.profit_margin_percent)}% de utilidad
          </span>
        </div>
      </section>

      <div className="grid gap-7 xl:grid-cols-[1.45fr_0.75fr]">
        <div className="space-y-7">
          <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <div className="border-b border-stone-100 p-6">
              <h2 className="text-xl font-black text-stone-900">
                Ingredientes
              </h2>
            </div>
            <div className="divide-y divide-stone-100">
              {relations.map((relation) => {
                const ingredient = getRelatedObject(relation.ingredients);
                if (!ingredient) return null;

                const itemCost =
                  getIngredientUnitCost(ingredient) *
                  Number(relation.quantity_needed || 0);
                const enoughStock =
                  Boolean(ingredient.is_active) &&
                  Number(ingredient.current_stock || 0) >=
                    Number(relation.quantity_needed || 0);

                return (
                  <div
                    key={relation.id}
                    className="grid gap-3 px-6 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"
                  >
                    <div>
                      <p className="font-black text-stone-900">
                        {ingredient.name}
                      </p>
                      <p className="mt-1 text-xs text-stone-500">
                        Disponible: {quantity(ingredient.current_stock)}{" "}
                        {ingredient.unit}
                      </p>
                    </div>
                    <p className="font-bold text-stone-700">
                      {quantity(relation.quantity_needed)} {ingredient.unit}
                    </p>
                    <div className="text-right">
                      <p className="font-black text-stone-800">
                        {money(itemCost)}
                      </p>
                      <span
                        className={`mt-1 inline-block rounded-full px-2.5 py-1 text-xs font-black ${
                          enoughStock
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {enoughStock ? "Disponible" : "Insuficiente"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <div className="border-b border-stone-100 p-6">
              <h2 className="text-xl font-black text-stone-900">Preparación</h2>
            </div>
            <div className="space-y-5 p-6">
              {steps.length === 0 ? (
                <p className="text-sm text-stone-500">Sin pasos registrados.</p>
              ) : (
                steps.map((step) => (
                  <div key={step.id} className="flex gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 font-black text-orange-800">
                      {step.step_number}
                    </span>
                    <p className="pt-2 text-sm leading-6 text-stone-700">
                      {step.description}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <CostSummary calculations={calculations} />
      </div>
    </>
  );
}

function RecipeEditor({
  categories,
  inventory,
  name,
  setName,
  categoryId,
  setCategoryId,
  electricTime,
  setElectricTime,
  gasTime,
  setGasTime,
  laborCost,
  setLaborCost,
  profitMargin,
  setProfitMargin,
  ingredients,
  updateIngredient,
  addIngredient,
  removeIngredient,
  steps,
  updateStep,
  addStep,
  removeStep,
  moveStep,
  calculations,
}) {
  return (
    <div className="grid gap-7 xl:grid-cols-[1.45fr_0.75fr]">
      <div className="space-y-7">
        <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-stone-900">
            Información general
          </h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="md:col-span-2">
              <span className="mb-2 block text-sm font-bold text-stone-700">
                Nombre
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
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
                  value={electricTime}
                  onChange={(event) => setElectricTime(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 pr-16 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-stone-400">
                  min
                </span>
              </div>
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
                  value={gasTime}
                  onChange={(event) => setGasTime(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 pr-16 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-stone-400">
                  min
                </span>
              </div>
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
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 py-3 pl-9 pr-4 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />
              </div>
            </label>

            <label>
              <span className="mb-2 block text-sm font-bold text-stone-700">
                Porcentaje de utilidad
              </span>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="999.99"
                  step="0.01"
                  value={profitMargin}
                  onChange={(event) => setProfitMargin(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 pr-12 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-stone-400">
                  %
                </span>
              </div>
            </label>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-stone-100 p-6">
            <div>
              <h2 className="text-xl font-black text-stone-900">
                Editar ingredientes
              </h2>
              <p className="mt-1 text-sm text-stone-500">
                Cambia el insumo o su cantidad en cualquier fila.
              </p>
            </div>
            <button
              type="button"
              onClick={addIngredient}
              className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-black text-orange-800"
            >
              + Agregar
            </button>
          </div>

          <div className="space-y-4 p-6">
            {ingredients.map((row, index) => {
              const selectedIngredient = inventory.find(
                (item) => item.id === row.ingredientId,
              );
              const rowCost =
                getIngredientUnitCost(selectedIngredient) *
                Number(row.quantityNeeded || 0);

              return (
                <div
                  key={index}
                  className="grid gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 md:grid-cols-[1fr_180px_130px_auto] md:items-end"
                >
                  <label>
                    <span className="mb-2 block text-xs font-black uppercase tracking-wider text-stone-500">
                      Insumo
                    </span>
                    <select
                      value={row.ingredientId}
                      onChange={(event) =>
                        updateIngredient(
                          index,
                          "ingredientId",
                          event.target.value,
                        )
                      }
                      className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                    >
                      <option value="">Selecciona un ingrediente</option>
                      {inventory.map((ingredient) => (
                        <option key={ingredient.id} value={ingredient.id}>
                          {ingredient.name} ·{" "}
                          {quantity(ingredient.current_stock)} {ingredient.unit}
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
                          updateIngredient(
                            index,
                            "quantityNeeded",
                            event.target.value,
                          )
                        }
                        className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 pr-14 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-stone-400">
                        {selectedIngredient?.unit || "—"}
                      </span>
                    </div>
                  </label>

                  <div>
                    <span className="mb-2 block text-xs font-black uppercase tracking-wider text-stone-500">
                      Costo
                    </span>
                    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-right font-black text-stone-800">
                      {money(rowCost)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeIngredient(index)}
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700"
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
                Editar preparación
              </h2>
              <p className="mt-1 text-sm text-stone-500">
                Modifica, agrega, elimina o reordena los pasos.
              </p>
            </div>
            <button
              type="button"
              onClick={addStep}
              className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-black text-orange-800"
            >
              + Agregar paso
            </button>
          </div>

          <div className="space-y-4 p-6">
            {steps.map((step, index) => (
              <div
                key={index}
                className="flex gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#3b2a20] font-black text-white">
                  {index + 1}
                </span>
                <textarea
                  value={step.description}
                  onChange={(event) => updateStep(index, event.target.value)}
                  rows={3}
                  className="min-h-24 flex-1 resize-y rounded-xl border border-stone-300 bg-white px-4 py-3 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                />
                <div className="flex shrink-0 flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => moveStep(index, -1)}
                    disabled={index === 0}
                    className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-black text-stone-700 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStep(index, 1)}
                    disabled={index === steps.length - 1}
                    className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-black text-stone-700 disabled:opacity-30"
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

      <CostSummary calculations={calculations} />
    </div>
  );
}

function CostSummary({ calculations }) {
  return (
    <aside>
      <div className="sticky top-28 overflow-hidden rounded-2xl bg-[#3b2a20] text-white shadow-xl">
        <div className="border-b border-white/10 p-6">
          <p className="text-xs font-black uppercase tracking-[.16em] text-orange-200">
            Desglose
          </p>
          <h2 className="mt-2 text-xl font-black">Costo de la receta</h2>
        </div>
        <div className="space-y-4 p-6 text-sm">
          <CostRow
            label="Ingredientes"
            value={money(calculations.ingredientCost)}
          />
          <CostRow
            label="Electricidad"
            value={money(calculations.electricCost)}
          />
          <CostRow label="Gas" value={money(calculations.gasCost)} />
          <CostRow label="Mano de obra" value={money(calculations.laborCost)} />
          <div className="border-t border-white/15 pt-4">
            <CostRow
              label="Costo total"
              value={money(calculations.totalCost)}
            />
            <div className="mt-3">
              <CostRow
                label={`Utilidad (${quantity(calculations.profitPercent)}%)`}
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
        </div>
      </div>
    </aside>
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
