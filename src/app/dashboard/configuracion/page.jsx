"use client";

import { useEffect, useRef, useState } from "react";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

async function getConfigurationData() {
  const [configResult, categoriesResult] = await Promise.all([
    supabase
      .from("app_config")
      .select(
        `
          id,
          user_id,
          business_name,
          logo_url,
          kwh_cost,
          electric_power_watts,
          oven_power_watts,
          gas_hourly_cost,
          low_stock_percentage,
          updated_at
        `,
      )
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("categories")
      .select("id, name, description, created_at, updated_at")
      .order("name", { ascending: true }),
  ]);

  if (configResult.error) throw configResult.error;
  if (categoriesResult.error) throw categoriesResult.error;

  return {
    config: configResult.data,
    categories: categoriesResult.data ?? [],
  };
}

export default function ConfiguracionPage() {
  const [configId, setConfigId] = useState(null);
  const [businessName, setBusinessName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoPreview, setLogoPreview] = useState("");
  const [logoFile, setLogoFile] = useState(null);
  const [kwhCost, setKwhCost] = useState("");
  const [electricPowerWatts, setElectricPowerWatts] = useState("");
  const [gasHourlyCost, setGasHourlyCost] = useState("10");
  const [lowStockPercentage, setLowStockPercentage] = useState("20");

  const [categories, setCategories] = useState([]);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");

  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);

  const localPreviewRef = useRef("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await getConfigurationData();

        if (!active) return;

        setCategories(data.categories);

        if (data.config) {
          setConfigId(data.config.id);
          setBusinessName(data.config.business_name ?? "");
          setLogoUrl(data.config.logo_url ?? "");
          setLogoPreview(data.config.logo_url ?? "");
          setKwhCost(String(data.config.kwh_cost ?? ""));
          setElectricPowerWatts(
            String(
              data.config.electric_power_watts ??
                data.config.oven_power_watts ??
                "",
            ),
          );
          setGasHourlyCost(String(data.config.gas_hourly_cost ?? 10));
          setLowStockPercentage(String(data.config.low_stock_percentage ?? 20));
        }
      } catch (error) {
        console.error(error);
        if (active) {
          await Swal.fire({
            icon: "error",
            title: "No se pudo cargar la configuración",
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
      if (localPreviewRef.current) {
        URL.revokeObjectURL(localPreviewRef.current);
      }
    };
  }, []);

  const refreshCategories = async () => {
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, description, created_at, updated_at")
      .order("name", { ascending: true });

    if (error) throw error;
    setCategories(data ?? []);
  };

  const handleLogoChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];

    if (!allowedTypes.includes(file.type)) {
      await Swal.fire({
        icon: "warning",
        title: "Formato no permitido",
        text: "Selecciona una imagen PNG, JPG, JPEG o WEBP.",
        confirmButtonColor: "#8b5e3c",
      });
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      await Swal.fire({
        icon: "warning",
        title: "Imagen demasiado grande",
        text: "El logotipo no debe superar los 5 MB.",
        confirmButtonColor: "#8b5e3c",
      });
      event.target.value = "";
      return;
    }

    if (localPreviewRef.current) {
      URL.revokeObjectURL(localPreviewRef.current);
    }

    const preview = URL.createObjectURL(file);
    localPreviewRef.current = preview;

    setLogoFile(file);
    setLogoPreview(preview);
  };

  const uploadLogo = async () => {
    if (!logoFile) return logoUrl;

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) throw userError;
    if (!user) throw new Error("No existe una sesión activa.");

    const extension = logoFile.name.split(".").pop()?.toLowerCase() || "png";
    const filePath = `${user.id}/logo-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("business-assets")
      .upload(filePath, logoFile, {
        cacheControl: "3600",
        upsert: false,
        contentType: logoFile.type,
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from("business-assets")
      .getPublicUrl(filePath);

    return data.publicUrl;
  };

  const handleSaveConfig = async (event) => {
    event.preventDefault();

    const normalizedName = businessName.trim();
    const parsedKwhCost = Number(kwhCost || 0);
    const parsedElectricPower = Number(electricPowerWatts || 0);
    const parsedGasHourlyCost = Number(gasHourlyCost || 0);
    const parsedLowStockPercentage = Number(lowStockPercentage);

    if (!normalizedName) {
      await Swal.fire({
        icon: "warning",
        title: "Nombre requerido",
        text: "Escribe el nombre del negocio.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    if (!Number.isFinite(parsedKwhCost) || parsedKwhCost < 0) {
      await Swal.fire({
        icon: "warning",
        title: "Costo inválido",
        text: "El costo por kWh debe ser igual o mayor que cero.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    if (!Number.isFinite(parsedElectricPower) || parsedElectricPower < 0) {
      await Swal.fire({
        icon: "warning",
        title: "Potencia inválida",
        text: "La potencia eléctrica estimada debe ser igual o mayor que cero.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    if (!Number.isFinite(parsedGasHourlyCost) || parsedGasHourlyCost < 0) {
      await Swal.fire({
        icon: "warning",
        title: "Costo inválido",
        text: "El costo de gas por hora debe ser igual o mayor que cero.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    if (
      !Number.isFinite(parsedLowStockPercentage) ||
      parsedLowStockPercentage < 0 ||
      parsedLowStockPercentage > 100
    ) {
      await Swal.fire({
        icon: "warning",
        title: "Porcentaje inválido",
        text: "El aviso preventivo debe estar entre 0 y 100.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    try {
      setSavingConfig(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("No existe una sesión activa.");

      const uploadedLogoUrl = await uploadLogo();

      const payload = {
        user_id: user.id,
        business_name: normalizedName,
        logo_url: uploadedLogoUrl || null,
        kwh_cost: parsedKwhCost,
        electric_power_watts: parsedElectricPower,
        oven_power_watts: parsedElectricPower,
        gas_hourly_cost: parsedGasHourlyCost,
        low_stock_percentage: parsedLowStockPercentage,
        updated_at: new Date().toISOString(),
      };

      if (configId) {
        const { error } = await supabase
          .from("app_config")
          .update(payload)
          .eq("id", configId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("app_config")
          .insert(payload)
          .select("id")
          .single();

        if (error) throw error;
        setConfigId(data.id);
      }

      setLogoUrl(uploadedLogoUrl || "");
      setLogoPreview(uploadedLogoUrl || "");
      setLogoFile(null);

      window.dispatchEvent(
        new CustomEvent("business-config-updated", {
          detail: {
            businessName: normalizedName,
            logoUrl: uploadedLogoUrl || "",
          },
        }),
      );

      await Swal.fire({
        icon: "success",
        title: "Configuración guardada",
        text: "Los datos del negocio se actualizaron correctamente.",
        timer: 1700,
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
      setSavingConfig(false);
    }
  };

  const handleAddCategory = async (event) => {
    event.preventDefault();

    const name = categoryName.trim();
    const description = categoryDescription.trim();

    if (!name) {
      await Swal.fire({
        icon: "warning",
        title: "Nombre requerido",
        text: "Escribe el nombre de la categoría.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    const duplicate = categories.some(
      (category) => category.name.trim().toLowerCase() === name.toLowerCase(),
    );

    if (duplicate) {
      await Swal.fire({
        icon: "info",
        title: "La categoría ya existe",
        text: "Utiliza otro nombre o edita la categoría existente.",
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    try {
      setSavingCategory(true);

      const { error } = await supabase.from("categories").insert({
        name,
        description: description || null,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;

      setCategoryName("");
      setCategoryDescription("");
      await refreshCategories();

      await Swal.fire({
        icon: "success",
        title: "Categoría agregada",
        timer: 1300,
        showConfirmButton: false,
      });
    } catch (error) {
      console.error(error);
      await Swal.fire({
        icon: "error",
        title: "No se pudo agregar",
        text: error.message,
        confirmButtonColor: "#8b5e3c",
      });
    } finally {
      setSavingCategory(false);
    }
  };

  const handleEditCategory = async (category) => {
    const result = await Swal.fire({
      title: "Editar categoría",
      html: `
        <div style="text-align:left">
          <label for="category-edit-name" style="display:block;font-size:14px;font-weight:700;margin-bottom:6px;color:#44403c">
            Nombre
          </label>
          <input id="category-edit-name" class="swal2-input" value="${escapeAttribute(
            category.name,
          )}" style="width:100%;margin:0 0 16px 0" />

          <label for="category-edit-description" style="display:block;font-size:14px;font-weight:700;margin-bottom:6px;color:#44403c">
            Descripción opcional
          </label>
          <textarea id="category-edit-description" class="swal2-textarea" style="width:100%;margin:0;min-height:110px">${escapeHtml(
            category.description || "",
          )}</textarea>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Guardar cambios",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#8b5e3c",
      cancelButtonColor: "#78716c",
      focusConfirm: false,
      preConfirm: () => {
        const name = document
          .getElementById("category-edit-name")
          ?.value.trim();
        const description = document
          .getElementById("category-edit-description")
          ?.value.trim();

        if (!name) {
          Swal.showValidationMessage("El nombre es obligatorio.");
          return false;
        }

        const duplicate = categories.some(
          (item) =>
            item.id !== category.id &&
            item.name.trim().toLowerCase() === name.toLowerCase(),
        );

        if (duplicate) {
          Swal.showValidationMessage(
            "Ya existe otra categoría con ese nombre.",
          );
          return false;
        }

        return { name, description };
      },
    });

    if (!result.isConfirmed || !result.value) return;

    try {
      const { error } = await supabase
        .from("categories")
        .update({
          name: result.value.name,
          description: result.value.description || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", category.id);

      if (error) throw error;

      await refreshCategories();

      await Swal.fire({
        icon: "success",
        title: "Categoría actualizada",
        timer: 1300,
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

  const handleDeleteCategory = async (category) => {
    const { count, error: countError } = await supabase
      .from("recipes")
      .select("id", { count: "exact", head: true })
      .eq("category_id", category.id);

    if (countError) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo comprobar la categoría",
        text: countError.message,
        confirmButtonColor: "#8b5e3c",
      });
      return;
    }

    const recipeCount = Number(count || 0);

    const result = await Swal.fire({
      icon: "warning",
      title: `¿Eliminar ${category.name}?`,
      html:
        recipeCount > 0
          ? `<p>Esta categoría se usa en <strong>${recipeCount} receta(s)</strong>.</p><p style="margin-top:10px">Las recetas se conservarán, pero quedarán como “Sin categoría”.</p>`
          : "La categoría se eliminará de la lista.",
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#b91c1c",
      cancelButtonColor: "#78716c",
      reverseButtons: true,
    });

    if (!result.isConfirmed) return;

    try {
      const { error } = await supabase
        .from("categories")
        .delete()
        .eq("id", category.id);

      if (error) throw error;

      await refreshCategories();

      await Swal.fire({
        icon: "success",
        title: "Categoría eliminada",
        timer: 1300,
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

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-orange-100 border-t-[#8b5e3c]" />
          <p className="font-medium text-stone-500">
            Cargando configuración...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <div>
        <p className="text-sm font-black uppercase tracking-[.16em] text-orange-700">
          Preferencias
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-stone-900">
          Configuración del negocio
        </h1>
        <p className="mt-2 text-stone-500">
          Personaliza el negocio, configura el horno y administra los tipos de
          receta.
        </p>
      </div>

      <form onSubmit={handleSaveConfig} className="space-y-6">
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-100 bg-orange-50/60 px-6 py-5">
            <h2 className="text-xl font-black text-stone-900">
              Identidad del negocio
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              El nombre y el logo aparecerán en el panel y en los PDF.
            </p>
          </div>

          <div className="grid gap-7 p-6 md:grid-cols-[220px_1fr] md:p-7">
            <div>
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-orange-200 bg-orange-50">
                {logoPreview ? (
                  <img
                    src={logoPreview}
                    alt="Vista previa del logotipo"
                    className="h-full w-full object-contain p-4"
                  />
                ) : (
                  <div className="text-center">
                    <div className="text-5xl">🍪</div>
                    <p className="mt-2 text-sm font-bold text-orange-800">
                      Sin logotipo
                    </p>
                  </div>
                )}
              </div>

              <label className="mt-4 block cursor-pointer rounded-xl bg-[#3b2a20] px-4 py-3 text-center text-sm font-black text-white transition hover:bg-[#2d2018]">
                Seleccionar imagen
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleLogoChange}
                  className="hidden"
                />
              </label>
              <p className="mt-2 text-center text-xs text-stone-400">
                PNG, JPG o WEBP. Máximo 5 MB.
              </p>
            </div>

            <div className="space-y-5">
              <label>
                <span className="mb-2 block text-sm font-bold text-stone-700">
                  Nombre del negocio
                </span>
                <input
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                  placeholder="Ej. Dulce Hogar"
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />
              </label>

              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5">
                <p className="text-sm font-black uppercase tracking-[.14em] text-orange-700">
                  Vista previa
                </p>
                <div className="mt-4 flex items-center gap-4">
                  <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-sm">
                    {logoPreview ? (
                      <img
                        src={logoPreview}
                        alt=""
                        className="h-full w-full object-contain p-1"
                      />
                    ) : (
                      "🍪"
                    )}
                  </span>
                  <div>
                    <p className="text-lg font-black text-stone-900">
                      {businessName.trim() || "Mi negocio"}
                    </p>
                    <p className="text-sm text-stone-500">
                      Costos, inventario y recetas
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-100 bg-amber-50/70 px-6 py-5">
            <h2 className="text-xl font-black text-stone-900">
              Costos de electricidad y gas
            </h2>

            <p className="mt-1 text-sm leading-6 text-stone-500">
              Configura el precio de la electricidad, la potencia del horno
              eléctrico y el costo estimado del gas. En cada receta podrás
              indicar por separado los minutos de electricidad y los minutos de
              gas.
            </p>
          </div>

          <div className="grid gap-5 p-6 md:grid-cols-2 md:p-7">
            {/* Electricidad */}
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-xl">
                  ⚡
                </div>

                <div>
                  <h3 className="font-black text-stone-900">Electricidad</h3>

                  <p className="mt-1 text-sm leading-6 text-stone-500">
                    Se utiliza para calcular el costo del horno eléctrico. Si su
                    horno es de gas, puedes dejar la potencia en 0.
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-5">
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-stone-700">
                    Costo por kWh
                  </span>

                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-stone-400">
                      $
                    </span>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={kwhCost}
                      onChange={(event) => setKwhCost(event.target.value)}
                      placeholder="1.37"
                      className="w-full rounded-xl border border-stone-300 bg-white py-3 pl-9 pr-4 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                    />
                  </div>

                  <p className="mt-2 text-xs leading-5 text-stone-500">
                    Con el recibo que revisamos puedes comenzar utilizando
                    aproximadamente $1.37 por kWh.
                  </p>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-stone-700">
                    Potencia del horno eléctrico
                  </span>

                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={electricPowerWatts}
                      onChange={(event) =>
                        setElectricPowerWatts(event.target.value)
                      }
                      placeholder="1800"
                      className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 pr-20 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                    />

                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-400">
                      watts
                    </span>
                  </div>

                  <p className="mt-2 text-xs leading-5 text-stone-500">
                    Busca la potencia en la etiqueta del horno. Puede aparecer
                    como 1200 W, 1500 W, 1800 W o un valor similar. Si el horno
                    es de gas, deja este campo en 0.
                  </p>
                </label>

                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-black text-amber-900">
                    Cálculo de electricidad
                  </p>

                  <p className="mt-2 text-xs leading-5 text-amber-800">
                    Potencia del horno en kW × minutos de electricidad ÷ 60 ×
                    costo por kWh.
                  </p>
                </div>
              </div>
            </div>

            {/* Gas */}
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-xl">
                  🔥
                </div>

                <div>
                  <h3 className="font-black text-stone-900">Gas</h3>

                  <p className="mt-1 text-sm leading-6 text-stone-500">
                    Se utiliza para calcular el consumo del horno de gas, la
                    estufa o los quemadores utilizados para preparar una receta.
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-stone-700">
                    Costo estimado de gas por hora
                  </span>

                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-stone-400">
                      $
                    </span>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={gasHourlyCost}
                      onChange={(event) => setGasHourlyCost(event.target.value)}
                      placeholder="7.00"
                      className="w-full rounded-xl border border-stone-300 bg-white py-3 pl-9 pr-24 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                    />

                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-400">
                      por hora
                    </span>
                  </div>

                  <p className="mt-2 text-xs leading-5 text-stone-500">
                    Por ahora puedes usar $7.00 por hora como estimación para un
                    horno doméstico de gas utilizado para galletas, roles,
                    brownies y preparaciones similares.
                  </p>
                </label>

                <div className="mt-5 rounded-xl border border-orange-200 bg-orange-50 p-4">
                  <p className="text-sm font-black text-orange-900">
                    Cálculo de gas
                  </p>

                  <p className="mt-2 text-xs leading-5 text-orange-800">
                    Minutos de gas ÷ 60 × costo estimado de gas por hora.
                  </p>
                </div>

                <div className="mt-5 rounded-xl border border-stone-200 bg-white p-4">
                  <p className="text-sm font-black text-stone-800">Ejemplo</p>

                  <p className="mt-2 text-xs leading-5 text-stone-600">
                    Una receta que utiliza 40 minutos de gas con un costo de
                    $7.00 por hora tendrá un costo aproximado de gas de $4.67.
                  </p>
                </div>
              </div>
            </div>

            {/* Explicación general */}
            <div className="rounded-2xl border border-[#d8c4ae] bg-[#fffaf4] p-5 md:col-span-2">
              <p className="font-black text-[#6f482e]">
                ¿Cómo se utiliza en las recetas?
              </p>

              <p className="mt-2 text-sm leading-6 text-stone-600">
                En cada receta encontrarás dos campos diferentes:
                <strong> minutos de electricidad</strong> y
                <strong> minutos de gas</strong>. Puedes utilizar los dos al
                mismo tiempo o dejar cualquiera en 0 cuando no se necesite.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-stone-200 bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-wider text-stone-400">
                    Solo gas
                  </p>

                  <p className="mt-2 text-sm font-bold text-stone-800">
                    Electricidad: 0 min
                  </p>

                  <p className="mt-1 text-sm font-bold text-stone-800">
                    Gas: 40 min
                  </p>
                </div>

                <div className="rounded-xl border border-stone-200 bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-wider text-stone-400">
                    Solo electricidad
                  </p>

                  <p className="mt-2 text-sm font-bold text-stone-800">
                    Electricidad: 30 min
                  </p>

                  <p className="mt-1 text-sm font-bold text-stone-800">
                    Gas: 0 min
                  </p>
                </div>

                <div className="rounded-xl border border-stone-200 bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-wider text-stone-400">
                    Uso combinado
                  </p>

                  <p className="mt-2 text-sm font-bold text-stone-800">
                    Electricidad: 10 min
                  </p>

                  <p className="mt-1 text-sm font-bold text-stone-800">
                    Gas: 45 min
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingConfig}
            className="w-full rounded-xl bg-[#8b5e3c] px-7 py-3 font-black text-white transition hover:bg-[#70472d] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {savingConfig ? "Guardando..." : "Guardar configuración"}
          </button>
        </div>
      </form>

      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-100 bg-stone-50 px-6 py-5">
          <h2 className="text-xl font-black text-stone-900">
            Categorías de recetas
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Ejemplos: galletas, roles, brownies, muffins, pasteles o coberturas.
          </p>
        </div>

        <form
          onSubmit={handleAddCategory}
          className="grid gap-4 border-b border-stone-100 p-6 md:grid-cols-[1fr_1.5fr_auto] md:items-end"
        >
          <label>
            <span className="mb-2 block text-sm font-bold text-stone-700">
              Nombre
            </span>
            <input
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder="Ej. Brownies"
              className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
            />
          </label>

          <label>
            <span className="mb-2 block text-sm font-bold text-stone-700">
              Descripción opcional
            </span>
            <input
              value={categoryDescription}
              onChange={(event) => setCategoryDescription(event.target.value)}
              placeholder="Ej. Preparaciones horneadas de chocolate"
              className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
            />
          </label>

          <button
            type="submit"
            disabled={savingCategory}
            className="rounded-xl bg-[#3b2a20] px-5 py-3 font-black text-white transition hover:bg-[#2d2018] disabled:opacity-60"
          >
            {savingCategory ? "Agregando..." : "Agregar categoría"}
          </button>
        </form>

        {categories.length === 0 ? (
          <div className="px-6 py-12 text-center text-stone-500">
            Todavía no hay categorías. Agrega la primera arriba.
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {categories.map((category) => (
              <article
                key={category.id}
                className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-black text-stone-900">{category.name}</p>
                  <p className="mt-1 text-sm text-stone-500">
                    {category.description || "Sin descripción"}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleEditCategory(category)}
                    className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-black text-stone-700 transition hover:border-orange-300 hover:bg-orange-50"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCategory(category)}
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-black text-red-700 transition hover:bg-red-100"
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
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
