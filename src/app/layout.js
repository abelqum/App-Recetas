import "./globals.css";

export const metadata = {
  title: "Sistema de Recetas",
  description: "Gestión de inventario y costeo de recetas",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body className="bg-gray-100 text-gray-900 font-sans">{children}</body>
    </html>
  );
}
