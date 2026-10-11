import { formatPrice, total, type Item } from "./cart"

const cart: Item[] = [
  { name: "Keyboard", price: 4999, qty: 1 },
  { name: "Cable", price: 899, qty: 2 },
]

console.log(formatPrice(total(cart)))
