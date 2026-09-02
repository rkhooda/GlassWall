// ShopLite state: seeded persona + cart/orders persisted in localStorage.
// The seed comes from ?seed= (default 1337) and is pinned in sessionStorage so
// in-app navigation keeps the same persona.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { generatePersona, type Persona } from '../../data/generator';

export interface Product {
  id: number;
  sku: string;
  name: string;
  price: number;
  blurb: string;
}

export const PRODUCTS: Product[] = [
  { id: 1, sku: 'SKU-BLUE-KETTLE', name: 'Blue Kettle', price: 2999, blurb: '1.7 L stainless steel, auto shut-off' },
  { id: 2, sku: 'SKU-WIRELESS-EARBUDS', name: 'Wireless Earbuds', price: 1499, blurb: 'Bluetooth 5.3, 24 h battery' },
  { id: 3, sku: 'SKU-AERON-CHAIR', name: 'Aeron Chair', price: 24999, blurb: 'Ergonomic mesh office chair' },
  { id: 4, sku: 'SKU-COFFEE-MUG', name: 'Coffee Mug', price: 499, blurb: 'Ceramic, 350 ml' },
  { id: 5, sku: 'SKU-DESK-LAMP', name: 'Desk Lamp', price: 799, blurb: 'LED, three brightness levels' },
  { id: 6, sku: 'SKU-NOTEBOOK', name: 'Notebook', price: 199, blurb: 'A5 ruled, 200 pages' },
];

export interface CartItem extends Product {
  quantity: number;
}

export interface Order {
  id: string;
  tracking: string;
  items: CartItem[];
  total: number;
  status: 'Processing' | 'Shipped' | 'Delivered';
  placedAt: number;
}

const KEY_CART = 'shoplite_cart';
const KEY_ORDERS = 'shoplite_orders';
const KEY_SEED = 'shoplite_seed';

export function resolveSeed(): number {
  const fromUrl = new URLSearchParams(window.location.search).get('seed');
  if (fromUrl && /^\d+$/.test(fromUrl)) {
    sessionStorage.setItem(KEY_SEED, fromUrl);
    return parseInt(fromUrl, 10);
  }
  const pinned = sessionStorage.getItem(KEY_SEED);
  return pinned ? parseInt(pinned, 10) : 1337;
}

/** The persona plus the few derived fields ShopLite renders as the "saved profile". */
export interface Profile {
  persona: Persona;
  name: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  pin: string;
  aadhaar: string;
  card: string;
  ids: Record<string, string>;
}

function firstOf(p: Persona, type: string, nth = 0): { value: string; value_id: string } {
  const hits = p.values.filter(v => v.type === type);
  const hit = hits[nth] ?? hits[0];
  return hit ? { value: hit.value, value_id: hit.value_id } : { value: '', value_id: 'v_0' };
}

export function buildProfile(seed: number): Profile {
  const persona = generatePersona(seed);
  const name = firstOf(persona, 'PERSON_NAME');
  const email = firstOf(persona, 'EMAIL');
  const phone = firstOf(persona, 'PHONE');
  const street = firstOf(persona, 'STREET_ADDRESS', 0);
  const city = firstOf(persona, 'STREET_ADDRESS', 1);
  const state = firstOf(persona, 'STREET_ADDRESS', 2);
  const pin = firstOf(persona, 'POSTAL_CODE');
  const aadhaar = firstOf(persona, 'AADHAAR');
  const card = firstOf(persona, 'CARD');
  return {
    persona,
    name: name.value,
    email: email.value,
    phone: phone.value,
    street: street.value,
    city: city.value,
    state: state.value,
    pin: pin.value,
    aadhaar: aadhaar.value,
    card: card.value,
    ids: {
      name: name.value_id,
      email: email.value_id,
      phone: phone.value_id,
      street: street.value_id,
      city: city.value_id,
      state: state.value_id,
      pin: pin.value_id,
      aadhaar: aadhaar.value_id,
      card: card.value_id,
    },
  };
}

function seededOrders(profile: Profile): Order[] {
  const day = 24 * 60 * 60 * 1000;
  const base = Date.UTC(2026, 7, 20);
  const mk = (n: number, product: Product, status: Order['status'], daysAgo: number): Order => ({
    id: `ORD-${profile.persona.seed}${String(n).padStart(3, '0')}`,
    tracking: `TRK${(profile.persona.seed * 7919 + n * 104729) % 100000000}`,
    items: [{ ...product, quantity: 1 }],
    total: product.price,
    status,
    placedAt: base - daysAgo * day,
  });
  return [
    mk(1, PRODUCTS[0]!, 'Delivered', 12),
    mk(2, PRODUCTS[3]!, 'Shipped', 3),
    mk(3, PRODUCTS[5]!, 'Processing', 1),
  ];
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function resetShopLite(): void {
  localStorage.removeItem(KEY_CART);
  localStorage.removeItem(KEY_ORDERS);
}

export function useShopLite() {
  const seed = useMemo(resolveSeed, []);
  const profile = useMemo(() => buildProfile(seed), [seed]);
  const [cart, setCart] = useState<CartItem[]>(() => readJson<CartItem[]>(KEY_CART, []));
  const [orders, setOrders] = useState<Order[]>(() => readJson<Order[] | null>(KEY_ORDERS, null) ?? seededOrders(profile));

  useEffect(() => { localStorage.setItem(KEY_CART, JSON.stringify(cart)); }, [cart]);
  useEffect(() => { localStorage.setItem(KEY_ORDERS, JSON.stringify(orders)); }, [orders]);

  const addToCart = useCallback((product: Product) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === product.id);
      if (existing) return prev.map(i => (i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i));
      return [...prev, { ...product, quantity: 1 }];
    });
  }, []);

  const setQuantity = useCallback((id: number, quantity: number) => {
    setCart(prev => (quantity <= 0 ? prev.filter(i => i.id !== id) : prev.map(i => (i.id === id ? { ...i, quantity } : i))));
  }, []);

  const placeOrder = useCallback((): Order => {
    const order: Order = {
      id: `ORD-${Date.now().toString(36).toUpperCase()}`,
      tracking: `TRK${Math.floor(Math.random() * 1e8)}`,
      items: cart,
      total: cart.reduce((s, i) => s + i.price * i.quantity, 0),
      status: 'Processing',
      placedAt: Date.now(),
    };
    setOrders(prev => [order, ...prev]);
    setCart([]);
    return order;
  }, [cart]);

  const reset = useCallback(() => {
    resetShopLite();
    setCart([]);
    setOrders(seededOrders(profile));
  }, [profile]);

  return { seed, profile, cart, orders, addToCart, setQuantity, placeOrder, reset };
}

export type ShopLiteStore = ReturnType<typeof useShopLite>;
