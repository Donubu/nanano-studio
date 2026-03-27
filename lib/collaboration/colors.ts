const COLLAB_COLORS = [
  "#FF6B6B", // rojo
  "#4ECDC4", // teal
  "#45B7D1", // azul
  "#96CEB4", // verde
  "#FFEAA7", // amarillo
  "#DDA0DD", // púrpura
  "#FF8C42", // naranja
  "#6C5CE7", // violeta
];

export function getUserColor(userId: number): string {
  return COLLAB_COLORS[userId % COLLAB_COLORS.length];
}
