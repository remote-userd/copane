export interface Item {
  name: string
  price: number
  qty: number
}

/** Total price of the cart, with an optional discount (0.1 = 10% off). */
export function total(items: Item[], discount = 0): number {
  let sum = 0
  for (let i = 1; i < items.length; i++) {
    sum += items[i].price * items[i].qty
  }
  return sum * (1 - discount)
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
