import type { BakeryOrder, Ingredient, ProductId, Recipe, StaffMember } from "@/domain/types";

export const ingredients: Ingredient[] = [
  { id: "bread-flour", name: "Bread flour", baseUnit: "g", onHand: 16000, reorderAt: 5000 },
  { id: "water", name: "Water", baseUnit: "g", onHand: 10000, reorderAt: 3000 },
  { id: "starter", name: "Sourdough starter", baseUnit: "g", onHand: 2500, reorderAt: 500 },
  { id: "salt", name: "Salt", baseUnit: "g", onHand: 800, reorderAt: 200 },
  { id: "milk", name: "Milk", baseUnit: "ml", onHand: 1000, reorderAt: 300 },
  { id: "sugar", name: "Sugar", baseUnit: "g", onHand: 1000, reorderAt: 250 },
  { id: "butter", name: "Butter", baseUnit: "g", onHand: 2500, reorderAt: 500 },
  { id: "yeast", name: "Yeast", baseUnit: "g", onHand: 300, reorderAt: 75 },
];

// Recipe quantities are measured per whole batch. Use one shared flour ID
// across every recipe; water is consistently measured in grams.
export const recipes: Record<ProductId, Recipe> = {
  sourdough: {
    productId: "sourdough",
    name: "Country sourdough",
    yieldQuantity: 4,
    yieldUnit: "loaves",
    ingredients: [
      { ingredientId: "bread-flour", quantity: 1600 },
      { ingredientId: "water", quantity: 1080 },
      { ingredientId: "starter", quantity: 320 },
      { ingredientId: "salt", quantity: 32 },
    ],
    prepMinutes: 20,
    bakeMinutes: 40,
  },
  "cinnamon-roll": {
    productId: "cinnamon-roll",
    name: "Cinnamon rolls",
    yieldQuantity: 12,
    yieldUnit: "rolls",
    ingredients: [
      { ingredientId: "bread-flour", quantity: 900 },
      { ingredientId: "milk", quantity: 360 },
      { ingredientId: "sugar", quantity: 120 },
      { ingredientId: "butter", quantity: 100 },
      { ingredientId: "yeast", quantity: 12 },
      { ingredientId: "salt", quantity: 10 },
    ],
    prepMinutes: 30,
    bakeMinutes: 22,
  },
  croissant: {
    productId: "croissant",
    name: "Butter croissants",
    yieldQuantity: 8,
    yieldUnit: "croissants",
    ingredients: [
      { ingredientId: "bread-flour", quantity: 1000 },
      { ingredientId: "water", quantity: 500 },
      { ingredientId: "sugar", quantity: 120 },
      { ingredientId: "yeast", quantity: 20 },
      { ingredientId: "salt", quantity: 20 },
      { ingredientId: "butter", quantity: 500 },
    ],
    prepMinutes: 45,
    bakeMinutes: 25,
  },
};

export const orders: BakeryOrder[] = [
  {
    id: "order-mina-cafe",
    customerName: "Mina Cafe",
    items: [
      { productId: "sourdough", quantity: 12 },
      { productId: "cinnamon-roll", quantity: 12 },
    ],
    dueAt: "10:00",
    note: "Please pack the rolls separately.",
    status: "submitted",
  },
  {
    id: "order-harbor-hotel",
    customerName: "Harbor Hotel",
    items: [
      { productId: "sourdough", quantity: 8 },
      { productId: "croissant", quantity: 24 },
    ],
    dueAt: "10:30",
    note: "Morning guest breakfast delivery.",
    status: "submitted",
  },
];

export const staff: StaffMember[] = [
  { id: "alex", name: "Hadi Shanavas", role: "manager", availableFrom: "07:00", availableUntil: "11:00", taskCapacity: 2 },
  { id: "ravi", name: "Ravi Patel", role: "baker", availableFrom: "07:00", availableUntil: "11:00", taskCapacity: 2 },
  { id: "june", name: "June Chen", role: "baker", availableFrom: "07:00", availableUntil: "11:00", taskCapacity: 2 },
  { id: "sam", name: "Sam Rivera", role: "packer", availableFrom: "08:30", availableUntil: "11:00", taskCapacity: 3 },
];

export const productLabels: Record<ProductId, string> = {
  sourdough: "Country sourdough",
  "cinnamon-roll": "Cinnamon rolls",
  croissant: "Butter croissants",
};
