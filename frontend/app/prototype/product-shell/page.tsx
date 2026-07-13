import { notFound } from "next/navigation"

import { ProductShellPrototype } from "@/components/prototype/product-shell-prototype"

type ProductShellPrototypePageProps = {
  searchParams: Promise<{ variant?: string | string[] }>
}

export const metadata = {
  title: "OpenCLI 产品壳融合模板",
}

export default async function ProductShellPrototypePage({
  searchParams,
}: ProductShellPrototypePageProps) {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  const params = await searchParams
  const rawVariant = Array.isArray(params.variant) ? params.variant[0] : params.variant

  return <ProductShellPrototype initialVariant={rawVariant} />
}
