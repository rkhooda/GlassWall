import { useState } from 'react';

const products = [
  { id: 1, name: 'Blue Kettle', price: 2999 },
  { id: 2, name: 'Wireless Earbuds', price: 1499 },
  { id: 3, name: 'Coffee Mug', price: 499 },
  { id: 4, name: 'Notebook', price: 199 },
  { id: 5, name: 'Desk Lamp', price: 799 },
];

const ProductList = ({ onAddToCart }: { onAddToCart: (product: {id: number; name: string; price: number}) => void }) => {
  return (
    <div className="product-list">
      <h1>Products</h1>
      <div className="products-grid">
        {products.map(product => (
          <div key={product.id} className="product-card">
            <h2>{product.name}</h2>
            <p>₹{product.price}</p>
            <button onClick={() => onAddToCart(product)}>
              Add to Cart
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProductList;