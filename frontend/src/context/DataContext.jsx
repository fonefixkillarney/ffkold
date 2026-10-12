"use client"

import { createContext, useContext, useEffect, useState, useCallback } from "react"
import { fetchProducts, fetchCategories, fetchBanners } from "@/lib/api"

const DataContext = createContext(null)

export function DataProvider({ children }) {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [banners, setBanners] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    // All three requests still go out together, but each one is applied the moment
    // it lands instead of waiting on the slowest. The catalogue is by far the
    // biggest response, and a Promise.all used to make the sidebar and the hero
    // slider — both small and quick — sit behind it before anything could paint.
    const categoriesReady = fetchCategories()
      .then((cats) => {
        if (!cancelled) setCategories(cats)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })

    const bannersReady = fetchBanners()
      .then((banns) => {
        if (!cancelled) setBanners(banns)
      })
      .catch(() => {
        // A missing hero slider is cosmetic — never block the store on it.
      })

    // `loading` has always meant "the catalogue isn't here yet" to every consumer
    // (it gates the product grids), so it is resolved by the products request alone.
    const productsReady = fetchProducts()
      .then((prods) => {
        if (!cancelled) setProducts(prods)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    Promise.all([categoriesReady, bannersReady, productsReady])

    return () => { cancelled = true }
  }, [])

  // Applies an admin price edit to local state so every view reading from
  // `products` (product page, category grid, etc.) reflects it immediately,
  // without waiting for a full refetch. `prices` = { price?, originalPrice? }.
  const updateProductPriceLocal = useCallback((id, prices) => {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...prices, priceOverridden: true } : p)))
  }, [])

  // Same idea for any other admin edit (stock): merges `patch` into the product.
  const updateProductLocal = useCallback((id, patch) => {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }, [])

  // Drops an admin-deleted product from every grid on screen without a refetch.
  const removeProductLocal = useCallback((id) => {
    setProducts((prev) => prev.filter((p) => p.id !== id))
  }, [])

  // Pulls the freshly approved products/banners into the storefront. The provider
  // sits in the root layout, so client-side navigation alone never re-runs the
  // initial load — the approval queue calls this after approving so the
  // Navigate button lands on a product page that can actually find the product.
  // `fresh` bypasses the catalogue's short browser cache, which would otherwise be
  // free to answer this with the pre-approval copy.
  const refreshData = useCallback(async () => {
    const [prods, banns] = await Promise.all([fetchProducts({ fresh: true }), fetchBanners()])
    setProducts(prods)
    setBanners(banns)
  }, [])

  return (
    <DataContext.Provider
      value={{
        products,
        categories,
        banners,
        loading,
        error,
        updateProductPriceLocal,
        updateProductLocal,
        removeProductLocal,
        refreshData,
      }}
    >
      {children}
    </DataContext.Provider>
  )
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error("useData must be used inside DataProvider")
  return ctx
}
