import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { piiAttrsSpan } from '../../../instrument';
import type { ShopLiteStore } from '../store';

interface Shipping {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postal: string;
}

const EMPTY: Shipping = { name: '', email: '', phone: '', address: '', city: '', postal: '' };

// The checkout page carries the hard extraction cases on purpose: a same-origin
// iframe, an open shadow root, and a modal that occludes the form.
export default function CheckoutPage({ store }: { store: ShopLiteStore }) {
  const navigate = useNavigate();
  const { profile } = store;
  const [form, setForm] = useState<Shipping>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const shadowHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = shadowHost.current;
    if (!host || host.shadowRoot) return;
    const shadow = host.attachShadow({ mode: 'open' });
    const badge = document.createElement('span');
    badge.textContent = 'Secure checkout';
    badge.setAttribute('style', 'background:#e6f4ea;color:#137333;padding:4px 8px;border-radius:4px;font-size:13px');
    shadow.appendChild(badge);
  }, []);

  const set = (k: keyof Shipping) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const missing = (Object.keys(EMPTY) as (keyof Shipping)[]).filter(k => !form[k].trim());
    if (missing.length) {
      setError(`Please fill: ${missing.join(', ')}`);
      return;
    }
    setError(null);
    setConfirming(true);
  };

  const confirm = () => {
    const order = store.placeOrder();
    setConfirming(false);
    navigate(`/shoplite/checkout/confirm/${order.id}`);
  };

  if (store.cart.length === 0 && !confirming) {
    return (
      <section>
        <h1>Checkout</h1>
        <p>Your cart is empty. <Link to="/shoplite/">Add something first.</Link></p>
      </section>
    );
  }

  return (
    <section className="checkout">
      <h1>Checkout</h1>

      <aside className="card saved-profile" aria-labelledby="saved-heading">
        <h2 id="saved-heading">Your saved details</h2>
        <dl>
          <dt>Name</dt><dd><span {...piiAttrsSpan('PERSON_NAME', 3, profile.ids.name!)}>{profile.name}</span></dd>
          <dt>Email</dt><dd><span {...piiAttrsSpan('EMAIL', 2, profile.ids.email!)}>{profile.email}</span></dd>
          <dt>Phone</dt><dd><span {...piiAttrsSpan('PHONE', 2, profile.ids.phone!)}>{profile.phone}</span></dd>
          <dt>Address</dt><dd><span {...piiAttrsSpan('STREET_ADDRESS', 3, profile.ids.street!)}>{profile.street}</span></dd>
          <dt>City</dt><dd><span {...piiAttrsSpan('STREET_ADDRESS', 3, profile.ids.city!)}>{profile.city}</span></dd>
          <dt>PIN</dt><dd><span {...piiAttrsSpan('POSTAL_CODE', 3, profile.ids.pin!)}>{profile.pin}</span></dd>
        </dl>
      </aside>

      <form className="card" onSubmit={submit} aria-labelledby="shipping-heading" noValidate>
        <h2 id="shipping-heading">Shipping address</h2>
        <div className="field">
          <label htmlFor="name">Full name</label>
          <input id="name" type="text" autoComplete="name" placeholder="Full name" value={form.name} onChange={set('name')} required />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={set('email')} required />
        </div>
        <div className="field">
          <label htmlFor="phone">Phone</label>
          <input id="phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" value={form.phone} onChange={set('phone')} required />
        </div>
        <div className="field">
          <label htmlFor="address">Street address</label>
          <input id="address" type="text" autoComplete="street-address" placeholder="House, street" value={form.address} onChange={set('address')} required />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="city">City</label>
            <input id="city" type="text" autoComplete="address-level2" placeholder="City" value={form.city} onChange={set('city')} required />
          </div>
          <div className="field">
            <label htmlFor="postal">PIN code</label>
            <input id="postal" type="text" inputMode="numeric" autoComplete="postal-code" placeholder="560001" value={form.postal} onChange={set('postal')} required />
          </div>
        </div>

        <h2>Payment</h2>
        <div className="field">
          <label htmlFor="cc-number">Card number</label>
          <input id="cc-number" type="text" inputMode="numeric" autoComplete="cc-number" placeholder="Card number" />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="cc-exp">Expiry</label>
            <input id="cc-exp" type="text" autoComplete="cc-exp" placeholder="MM/YY" />
          </div>
          <div className="field">
            <label htmlFor="cc-csc">CVC</label>
            <input id="cc-csc" type="password" inputMode="numeric" autoComplete="cc-csc" placeholder="CVC" />
          </div>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <span ref={shadowHost} />
          <button type="submit" className="primary" id="place-order">Place order</button>
        </div>
      </form>

      <div className="card">
        <h2>Gift message (embedded editor)</h2>
        <iframe
          title="Gift message editor"
          className="embedded"
          sandbox="allow-same-origin allow-scripts"
          srcDoc={'<!doctype html><body style="font-family:system-ui;margin:12px"><label for="gift">Gift message</label><br><input id="gift" placeholder="Optional message" style="width:90%;padding:6px"></body>'}
        />
      </div>

      {confirming && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-heading">
            <h2 id="confirm-heading">Confirm order</h2>
            <p>Ship to <strong>{form.name}</strong>, {form.address}, {form.city} {form.postal}?</p>
            <div className="actions">
              <button type="button" onClick={() => setConfirming(false)}>Back</button>
              <button type="button" className="primary" id="confirm-order" onClick={confirm}>Confirm order</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
