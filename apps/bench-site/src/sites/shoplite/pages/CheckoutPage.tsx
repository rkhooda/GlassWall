import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

const CheckoutPage = ({ cart, onPlaceOrder }: { cart: Array<{id: number; name: string; price: number; quantity: number}>; onPlaceOrder: () => void }) => {
  const [form, setForm] = useState({
    shipping: {
      name: '',
      streetAddress: '',
      postalCode: '',
      city: '',
      state: '',
      country: '',
      email: '',
      phone: '',
    },
    billing: {
      name: '',
      streetAddress: '',
      postalCode: '',
      city: '',
      state: '',
      country: '',
      email: '',
      phone: '',
    },
    payment: {
      ccNumber: '',
      ccCSC: '',
      expiryMonth: '',
      expiryYear: '',
    },
    copyShippingToBilling: true,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const shadowRef = useRef<HTMLDivElement>(null);

  // Handle input change
  const handleInputChange = (section: string, field: string, value: string) => {
    setForm(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value,
      },
    }));
  };

  // Handle copy shipping to billing
  const handleCopyChange = (checked: boolean) => {
    setForm(prev => ({
      ...prev,
      copyShippingToBilling: checked,
    }));
    if (checked) {
      setForm(prev => ({
        ...prev,
        billing: { ...prev.shipping },
      }));
    }
  };

  // Handle place order
  const handlePlaceOrder = () => {
    // In a real app, we would validate and then process the order
    setModalOpen(true);
    // Call the callback to notify the parent (App) to proceed to orders
    // But note: we are in the checkout page, and the App will handle navigation
    // We'll call onPlaceOrder after a short delay to allow modal to show?
    // Actually, we want to open the modal and then when the user confirms, we navigate.
    // For simplicity, we'll open the modal and then when the user clicks "Confirm" in the modal, we call onPlaceOrder and navigate.
    // We'll handle that in the modal.
  };

  // Shadow DOM effect
  useEffect(() => {
    const div = shadowRef.current;
    if (!div) return;

    const shadow = div.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .badge {
        background-color: #4caf50;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 14px;
      }
    `;
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = 'Secure Checkout';
    shadow.appendChild(style);
    shadow.appendChild(badge);
  }, []);

  // Iframe content (same-origin iframe with a form field)
  const iframeSrcDoc = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Iframe Form</title>
      <style>
        body { font-family: sans-serif; margin: 20px; }
        .field { margin-bottom: 10px; }
        label { display: block; margin-bottom: 5px; }
        input { width: 100%; padding: 8px; box-sizing: border-box; }
      </style>
    </head>
    <body>
      <div class="field">
        <label for="iframe-field">Embedded Field:</label>
        <input type="text" id="iframe-field" placeholder="Enter something" />
      </div>
    </body>
    </html>
  `;

  return (
    <div className="checkout-page">
      <h1>Checkout</h1>
      <div className="checkout-form">
        <div className="section">
          <h2>Shipping Information</h2>
          <div className="field">
            <label htmlFor="shipping-name">Name:</label>
            <input
              type="text"
              id="shipping-name"
              value={form.shipping.name}
              onChange={(e) => handleInputChange('shipping', 'name', e.target.value)}
              autocomplete="name"
              placeholder="John Doe"
            />
          </div>
          <div className="field">
            <label htmlFor="shipping-street">Street Address:</label>
            <input
              type="text"
              id="shipping-street"
              value={form.shipping.streetAddress}
              onChange={(e) => handleInputChange('shipping', 'streetAddress', e.target.value)}
              autocomplete="street-address"
              placeholder="123 Main St"
            />
          </div>
          <div className="field">
            <label htmlFor="shipping-postal">Postal Code:</label>
            <input
              type="text"
              id="shipping-postal"
              value={form.shipping.postalCode}
              onChange={(e) => handleInputChange('shipping', 'postalCode', e.target.value)}
              autocomplete="postal-code"
              placeholder="123456"
            />
          </div>
          <div className="field">
            <label htmlFor="shipping-city">City:</label>
            <input
              type="text"
              id="shipping-city"
              value={form.shipping.city}
              onChange={(e) => handleInputChange('shipping', 'city', e.target.value)}
              autocomplete="address-level2"
              placeholder="New Delhi"
            />
          </div>
          <div className="field">
            <label htmlFor="shipping-state">State:</label>
            <input
              type="text"
              id="shipping-state"
              value={form.shipping.state}
              onChange={(e) => handleInputChange('shipping', 'state', e.target.value)}
              autocomplete="address-level1"
              placeholder="Delhi"
            />
          </div>
          <div className="field">
            <label htmlFor="shipping-country">Country:</label>
            <input
              type="text"
              id="shipping-country"
              value={form.shipping.country}
              onChange={(e) => handleInputChange('shipping', 'country', e.target.value)}
              autocomplete="country"
              placeholder="India"
            />
          </div>
          <div className="field">
            <label htmlFor="shipping-email">Email:</label>
            <input
              type="email"
              id="shipping-email"
              value={form.shipping.email}
              onChange={(e) => handleInputChange('shipping', 'email', e.target.value)}
              autocomplete="email"
              placeholder="john@example.com"
            />
          </div>
          <div className="field">
            <label htmlFor="shipping-phone">Phone:</label>
            <input
              type="tel"
              id="shipping-phone"
              value={form.shipping.phone}
              onChange={(e) => handleInputChange('shipping', 'phone', e.target.value)}
              autocomplete="tel"
              placeholder="+91 98765 43210"
            />
          </div>
        </div>

        <div className="section">
          <h2>Billing Information</h2>
          <div className="field">
            <label htmlFor="copy-shipping">
              <input
                type="checkbox"
                id="copy-shipping"
                checked={form.copyShippingToBilling}
                onChange={(e) => handleCopyChange(e.target.checked)}
              />
              Ship to billing address
            </label>
          </div>
          <div className="field">
            <label htmlFor="billing-name">Name:</label>
            <input
              type="text"
              id="billing-name"
              value={form.billing.name}
              onChange={(e) => handleInputChange('billing', 'name', e.target.value)}
              autocomplete="name"
              placeholder="John Doe"
              disabled={form.copyShippingToBilling}
            />
          </div>
          <div className="field">
            <label htmlFor="billing-street">Street Address:</label>
            <input
              type="text"
              id="billing-street"
              value={form.billing.streetAddress}
              onChange={(e) => handleInputChange('billing', 'streetAddress', e.target.value)}
              autocomplete="street-address"
              placeholder="123 Main St"
              disabled={form.copyShippingToBilling}
            />
          </div>
          <div className="field">
            <label htmlFor="billing-postal">Postal Code:</label>
            <input
              type="text"
              id="billing-postal"
              value={form.billing.postalCode}
              onChange={(e) => handleInputChange('billing', 'postalCode', e.target.value)}
              autocomplete="postal-code"
              placeholder="123456"
              disabled={form.copyShippingToBilling}
            />
          </div>
          <div className="field">
            <label htmlFor="billing-city">City:</label>
            <input
              type="text"
              id="billing-city"
              value={form.billing.city}
              onChange={(e) => handleInputChange('billing', 'city', e.target.value)}
              autocomplete="address-level2"
              placeholder="New Delhi"
              disabled={form.copyShippingToBilling}
            />
          </div>
          <div className="field">
            <label htmlFor="billing-state">State:</label>
            <input
              type="text"
              id="billing-state"
              value={form.billing.state}
              onChange={(e) => handleInputChange('billing', 'state', e.target.value)}
              autocomplete="address-level1"
              placeholder="Delhi"
              disabled={form.copyShippingToBilling}
            />
          </div>
          <div className="field">
            <label htmlFor="billing-country">Country:</label>
            <input
              type="text"
              id="billing-country"
              value={form.billing.country}
              onChange={(e) => handleInputChange('billing', 'country', e.target.value)}
              autocomplete="country"
              placeholder="India"
              disabled={form.copyShippingToBilling}
            />
          </div>
          <div className="field">
            <label htmlFor="billing-email">Email:</label>
            <input
              type="email"
              id="billing-email"
              value={form.billing.email}
              onChange={(e) => handleInputChange('billing', 'email', e.target.value)}
              autocomplete="email"
              placeholder="john@example.com"
              disabled={form.copyShippingToBilling}
            />
          </div>
          <div className="field">
            <label htmlFor="billing-phone">Phone:</label>
            <input
              type="tel"
              id="billing-phone"
              value={form.billing.phone}
              onChange={(e) => handleInputChange('billing', 'phone', e.target.value)}
              autocomplete="tel"
              placeholder="+91 98765 43210"
              disabled={form.copyShippingToBilling}
            />
          </div>
        </div>

        <div className="section">
          <h2>Payment Information</h2>
          <div className="field">
            <label htmlFor="cc-number">Card Number:</label>
            <input
              type="text"
              id="cc-number"
              value={form.payment.ccNumber}
              onChange={(e) => handleInputChange('payment', 'ccNumber', e.target.value)}
              autocomplete="cc-number"
              placeholder="•••• •••• •••• ••••"
            />
          </div>
          <div className="field">
            <label htmlFor="cc-csc">CSC:</label>
            <input
              type="text"
              id="cc-csc"
              value={form.payment.ccCSC}
              onChange={(e) => handleInputChange('payment', 'ccCSC', e.target.value)}
              autocomplete="cc-csc"
              placeholder="•••"
            />
          </div>
          <div className="field">
            <label htmlFor="cc-expiry">Expiry Date:</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                id="cc-expiry-month"
                value={form.payment.expiryMonth}
                onChange={(e) => handleInputChange('payment', 'expiryMonth', e.target.value)}
                autocomplete="cc-exp-month"
                placeholder="MM"
                style={{ width: '50px' }}
              />
              <span>/</span>
              <input
                type="text"
                id="cc-expiry-year"
                value={form.payment.expiryYear}
                onChange={(e) => handleInputChange('payment', 'expiryYear', e.target.value)}
                autocomplete="cc-exp-year"
                placeholder="YY"
                style={{ width: '50px' }}
              />
            </div>
          </div>
        </div>

        {/* Same-origin iframe containing a form field */}
        <div className="section">
          <h2>Embedded Form (Same-origin Iframe)</h2>
          <iframe
            title="Embedded form"
            width="100%"
            height="150px"
            sandbox="allow-same-origin allow-scripts"
            srcDoc={iframeSrcDoc}
          />
        </div>

        {/* Open shadow DOM component */}
        <div className="section">
          <h2>Security Badge (Shadow DOM)</h2>
          <div ref={shadowRef} style={{ display: 'inline-block' }}></div>
        </div>

        <button onClick={handlePlaceOrder} className="btn btn-primary">
          Place Order
        </button>
      </div>

      {/* Modal for occlusion testing */}
      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="modal-content">
            <h2>Order Confirmation</h2>
            <p>Thank you for your order!</p>
            <p>We will notify you when your order ships.</p>
            <button onClick={() => {
              setModalOpen(false);
              onPlaceOrder(); // Notify parent to proceed to orders
            }} className="btn btn-primary">
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CheckoutPage;