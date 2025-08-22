export type Coord = [number, number];

/**
 * Compute pairwise Euclidean distances between a list of IDs.
 *
 * @param ids - Array of identifiers whose coordinates are looked up in `idToCoord`.
 * @param idToCoord - Mapping from identifier to its `[x, y]` coordinates.
 * @returns A 2D matrix of distances where `result[i][j]` is the distance between
 *          `ids[i]` and `ids[j]`.
 * @throws If an identifier has no coordinate entry in `idToCoord`.
 */
export function pairwiseDistances(
  ids: string[],
  idToCoord: Record<string, Coord>
): number[][] {
  const distances: number[][] = [];

  for (let i = 0; i < ids.length; i++) {
    const coordI = idToCoord[ids[i]];
    if (!coordI) {
      throw new Error(`Missing coordinates for id "${ids[i]}"`);
    }

    distances[i] = [];

    for (let j = 0; j < ids.length; j++) {
      const coordJ = idToCoord[ids[j]];
      if (!coordJ) {
        throw new Error(`Missing coordinates for id "${ids[j]}"`);
      }

      const dx = coordI[0] - coordJ[0];
      const dy = coordI[1] - coordJ[1];
      distances[i][j] = Math.hypot(dx, dy);
    }
  }

  return distances;
}
