'use client';

import { useState } from 'react';
import { ShoppingCart, Heart, Minus, Plus, Pencil, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import StarRating from '@/app/components/ui/StarRating';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { useData } from '@/context/DataContext';
import { useWishlist } from '@/context/WishlistContext';
import { updateProductPrice, updateProductStock } from '@/lib/api';

// `onUpdated(patch)` lets the page mirror an admin edit onto a product it fetched
// on its own (one that isn't in the storefront catalogue, e.g. unapproved).
export default function ProductInfo({ product, onUpdated }) {
  const [qty, setQty] = useState(1);
  const { addToCart } = useCart();
  const { isWishlisted, toggleWishlist } = useWishlist();
  const { isAdmin, token } = useAuth();
  const { updateProductPriceLocal, updateProductLocal } = useData();
  const wishlisted = isWishlisted(product.id);
  const inStock = product.stock > 0;

  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(product.price);
  const [originalPriceInput, setOriginalPriceInput] = useState(product.originalPrice ?? '');
  const [savingPrice, setSavingPrice] = useState(false);

  const [editingStock, setEditingStock] = useState(false);
  const [stockInStock, setStockInStock] = useState(inStock);
  const [unitsInput, setUnitsInput] = useState(product.stock ?? 0);
  const [savingStock, setSavingStock] = useState(false);

  const startEditStock = () => {
    setStockInStock(inStock);
    setUnitsInput(inStock ? product.stock : 1);
    setEditingStock(true);
  };

  const applyStock = async (change, message) => {
    setSavingStock(true);
    try {
      const saved = await updateProductStock(product.id, change, token);
      const patch = { stock: saved.stock, stockOverridden: saved.stockOverridden };
      updateProductLocal(product.id, patch);
      onUpdated?.(patch);
      setQty((q) => Math.max(1, Math.min(q, saved.stock)));
      toast.success(message);
      setEditingStock(false);
    } catch (error) {
      toast.error(error.message || 'Failed to update stock');
    } finally {
      setSavingStock(false);
    }
  };

  const saveStock = () => {
    const units = stockInStock ? Number(unitsInput) : 0;
    if (stockInStock && (!Number.isInteger(units) || units < 1)) {
      toast.error('Enter at least 1 unit for an in-stock product');
      return;
    }
    applyStock({ stock: units }, units > 0 ? `Stock set to ${units} units` : 'Marked out of stock');
  };

  const decrement = () => setQty((q) => Math.max(1, q - 1));
  const increment = () => setQty((q) => Math.min(product.stock, q + 1));
  const handleQtyChange = (e) => {
    const val = parseInt(e.target.value) || 1;
    setQty(Math.min(product.stock, Math.max(1, val)));
  };

  const startEditPrice = () => {
    setPriceInput(product.price);
    setOriginalPriceInput(product.originalPrice ?? '');
    setEditingPrice(true);
  };

  const cancelEditPrice = () => setEditingPrice(false);

  const savePrice = async () => {
    const parsed = Number(priceInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error('Enter a valid price');
      return;
    }
    const parsedOriginal = originalPriceInput === '' ? null : Number(originalPriceInput);
    if (parsedOriginal !== null && (!Number.isFinite(parsedOriginal) || parsedOriginal < 0)) {
      toast.error('Enter a valid old price');
      return;
    }
    setSavingPrice(true);
    try {
      const prices = { price: parsed };
      if (parsedOriginal !== null) prices.originalPrice = parsedOriginal;
      await updateProductPrice(product.id, prices, token);
      updateProductPriceLocal(product.id, prices);
      toast.success('Prices updated');
      setEditingPrice(false);
    } catch (error) {
      toast.error(error.message || 'Failed to update price');
    } finally {
      setSavingPrice(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Brand */}
      <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{product.brand}</p>

      {/* Name */}
      <h1 className="text-2xl leading-snug">{product.name}</h1>

      {/* Rating */}
      {/* <div className="flex items-center gap-2">
        <StarRating rating={product.rating} count={product.reviewCount} size={16} />
        <a href="#reviews" className="text-xs text-primary hover:underline">
          {product.reviewCount} reviews
        </a>
      </div> */}

      {/* Price */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {editingPrice ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="edit-price" className="text-xs text-gray-500 dark:text-gray-400">
                Current price (€)
              </label>
              <input
                id="edit-price"
                type="number"
                min="0"
                step="0.01"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="input-field w-28"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="edit-original-price" className="text-xs text-gray-500 dark:text-gray-400">
                Old price (€)
              </label>
              <input
                id="edit-original-price"
                type="number"
                min="0"
                step="0.01"
                value={originalPriceInput}
                onChange={(e) => setOriginalPriceInput(e.target.value)}
                className="input-field w-28"
              />
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={savePrice}
                disabled={savingPrice}
                className="btn-icon text-green-600"
                aria-label="Save prices"
              >
                <Check size={18} />
              </button>
              <button
                type="button"
                onClick={cancelEditPrice}
                disabled={savingPrice}
                className="btn-icon text-primary hover:text-black"
                aria-label="Cancel edit"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-3xl font-extrabold text-black dark:text-primary">€{product.price.toFixed(2)}</span>
            {product.originalPrice > 0 && product.originalPrice !== product.price && (
              <span className="price-original text-base">€{product.originalPrice.toFixed(2)}</span>
            )}
            {product.isSale && (
              <span className="badge-sale text-sm">
                SALE{product.originalPrice
                  ? ` −${Math.round((1 - product.price / product.originalPrice) * 100)}%`
                  : ''}
              </span>
            )}
          </div>
        )}
        {isAdmin && !editingPrice && (
          <button
            type="button"
            onClick={startEditPrice}
            className="btn-icon text-gray-400 hover:text-primary"
            aria-label="Edit price"
          >
            <Pencil size={16} />
          </button>
        )}
      </div>

      {/* Divider */}
      <hr className="border-gray-100 dark:border-gray-800" />

      {/* Stock + Code */}
      <div className="flex flex-col gap-1.5 text-sm">
        {/* flex-wrap on each row: the label column is a fixed 7rem, so a long
            value (a full stock line, a 20-character product code) has only
            what is left of a phone screen and has to be allowed a second line
            rather than widening the page. */}
        {/* Admin-only: shoppers don't see stock levels; the Add to Cart button
            still turns into "Out of Stock" for them. */}
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-gray-500 dark:text-gray-400 w-28 shrink-0">Availability:</span>
            {editingStock ? (
              <div className="flex flex-wrap items-center gap-2">
                <fieldset className="flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600" aria-label="Stock status">
                  <button
                    type="button"
                    onClick={() => {
                      setStockInStock(true);
                      if (!(Number(unitsInput) > 0)) setUnitsInput(1);
                    }}
                    aria-pressed={stockInStock}
                    className={`cursor-pointer px-3 py-1 ${stockInStock ? 'bg-green-700 text-white' : 'text-gray-600 dark:text-gray-300'}`}
                  >
                    In Stock
                  </button>
                  <button
                    type="button"
                    onClick={() => setStockInStock(false)}
                    aria-pressed={!stockInStock}
                    className={`cursor-pointer px-3 py-1 ${!stockInStock ? 'bg-red-700 text-white' : 'text-gray-600 dark:text-gray-300'}`}
                  >
                    Out of Stock
                  </button>
                </fieldset>
                {stockInStock && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    Units
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={unitsInput}
                      onChange={(e) => setUnitsInput(e.target.value)}
                      className="input-field w-20"
                      aria-label="Units in stock"
                    />
                  </label>
                )}
                <button
                  type="button"
                  onClick={saveStock}
                  disabled={savingStock}
                  className="btn-icon text-green-600"
                  aria-label="Save stock"
                >
                  <Check size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingStock(false)}
                  disabled={savingStock}
                  className="btn-icon text-primary hover:text-black"
                  aria-label="Cancel stock edit"
                >
                  <X size={18} />
                </button>
              </div>
            ) : (
              <>
                {inStock ? (
                  <span className="bg-green-700 px-3 py-1 rounded-lg text-white">In Stock ({product.stock} units)</span>
                ) : (
                  <span className="bg-red-700 px-3 py-1 rounded-lg text-white">Out of Stock</span>
                )}
                <button
                  type="button"
                  onClick={startEditStock}
                  className="btn-icon text-gray-400 hover:text-primary"
                  aria-label="Edit stock"
                >
                  <Pencil size={16} />
                </button>
              </>
            )}
          </div>
        )}
        {/* Admin-only: whose figure this is. A hand-set stock is never touched
            by the scraper until it is handed back. */}
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="w-28 shrink-0" />
            {product.stockOverridden ? (
              <>
                <span className="text-gray-500 dark:text-gray-400">Set manually — scraper won&apos;t change it.</span>
                <button
                  type="button"
                  onClick={() =>
                    applyStock({ followSupplier: true }, 'Stock will follow the supplier from the next scrape')
                  }
                  disabled={savingStock}
                  className="cursor-pointer text-primary-dark underline hover:no-underline"
                >
                  Follow supplier stock
                </button>
              </>
            ) : (
              <span className="text-gray-500 dark:text-gray-400">Follows the supplier&apos;s stock on each scrape.</span>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-gray-500 dark:text-gray-400 w-28 shrink-0">Product Code:</span>
          <span className="font-mono text-xs text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-[#37352F] px-2 py-0.5 rounded">
            {product.id.toUpperCase()}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-gray-500 dark:text-gray-400 w-28 shrink-0">Brand:</span>
          <span className="text-gray-700 dark:text-gray-300">{product.manufacturer}</span>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{product.description}</p>

      <hr className="border-gray-100 dark:border-gray-800" />

      {/* Quantity selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500 dark:text-gray-400 w-28 shrink-0">Quantity:</span>
        <div className="flex items-center gap-1">
          <button
            onClick={decrement}
            disabled={qty <= 1 || !inStock}
            className="qty-btn bg-gray-100! dark:text-black dark:bg-primary! cursor-pointer"
          >
            <Minus
              size={13} />
          </button>
          <input
            type="number"
            value={qty}
            onChange={handleQtyChange}
            disabled={!inStock}
            min={1}
            max={product.stock}
            className="qty-input bg-gray-100! dark:text-black dark:bg-primary! cursor-pointer"
          />
          <button onClick={increment} disabled={qty >= product.stock || !inStock} className="qty-btn bg-gray-100! dark:text-black dark:bg-primary! cursor-pointer">
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* CTA buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={() => inStock && addToCart(product, qty)}
          disabled={!inStock}
          className="btn-blue"
        >
          <ShoppingCart size={17} />
          {inStock ? 'Add to Cart' : 'Out of Stock'}
        </button>
        <button
          onClick={() => toggleWishlist(product)}
          className={`btn-sec hover:text-red-600! hover:bg-red-100 group ${wishlisted ? 'bg-black text-primary border-black' : ''}`}
        >
          <Heart className='group-hover:text-red-600' size={17} fill={wishlisted ? 'currentColor' : 'none'} />
          {wishlisted ? 'Wishlisted' : 'Add to Wishlist'}
        </button>
      </div>

      {/* Tags */}
      {product.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {product.tags.map((tag) => (
            <span key={tag} className="text-xs bg-gray-100 dark:bg-primary text-gray-600 dark:text-black px-2 py-0.5 rounded">
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
