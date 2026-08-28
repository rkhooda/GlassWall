import { useState } from 'react';
import { Link } from 'react-router-dom';

const CartPage = ({
  cart,
  onRemoveFromCart,
  onUpdateQuantity,
  onCheckout,
}: {
  cart: Array<{id: number; name: string; price: number; quantity: number}>;
  onRemoveFromCart: (productId: number) => void;
  onUpdateQuantity: (productId: number, quantity: number) => void;
  onCheckout: () => void;
}) => {
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <div className="cart-page">
      <h1>Your Cart</h1>
      {cart.length === 0 ? (
        <p>Your cart is empty.</p>
      ) : (
        <>
          <table className="cart-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Price</th>
                <th>Quantity</th>
                <th>Total</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {cart.map(item => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>₹{item.price}</td>
                  <td>
                    <input
                      type="number"
                      value={item.quantity}
                      min="1"
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10) || 1;
                        onUpdateQuantity(item.id, value);
                      }}
                    />
                  </td>
                  <td>₹{item.price * item.quantity}</td>
                  <td>
                    <button onClick={() => onRemoveFromCart(item.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="3">Total</td>
                <td>₹{total}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <div className="cart-actions">
            <Link to="/" className="btn btn-outline">
              Continue Shopping
            </Link>
            <button onClick={onCheckout} className="btn btn-primary">
              Proceed to Checkout
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default CartPage;