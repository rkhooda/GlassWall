import { Link, useNavigate } from 'react-router-dom';
import type { ShopLiteStore } from '../store';

export default function CartPage({ store }: { store: ShopLiteStore }) {
  const navigate = useNavigate();
  const total = store.cart.reduce((s, i) => s + i.price * i.quantity, 0);

  return (
    <section>
      <h1>Your cart</h1>
      {store.cart.length === 0 ? (
        <p>
          Your cart is empty. <Link to="/shoplite/">Continue shopping</Link>
        </p>
      ) : (
        <>
          <table className="table" aria-label="Cart items">
            <thead>
              <tr><th>Product</th><th>Price</th><th>Qty</th><th>Total</th><th></th></tr>
            </thead>
            <tbody>
              {store.cart.map(item => (
                <tr key={item.id} data-sku={item.sku}>
                  <td>{item.name}</td>
                  <td>₹{item.price.toLocaleString('en-IN')}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      aria-label={`Quantity of ${item.name}`}
                      onChange={e => store.setQuantity(item.id, parseInt(e.target.value, 10) || 1)}
                    />
                  </td>
                  <td>₹{(item.price * item.quantity).toLocaleString('en-IN')}</td>
                  <td><button type="button" onClick={() => store.setQuantity(item.id, 0)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={3}>Total</td><td>₹{total.toLocaleString('en-IN')}</td><td></td></tr>
            </tfoot>
          </table>
          <div className="actions">
            <Link to="/shoplite/" className="button secondary">Continue shopping</Link>
            <button type="button" className="primary" id="proceed-to-checkout" onClick={() => navigate('/shoplite/checkout')}>
              Proceed to checkout
            </button>
          </div>
        </>
      )}
    </section>
  );
}
