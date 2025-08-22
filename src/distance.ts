export function minutesAtMph(distance: number, mph: number): number {
  if (mph <= 0) {
    throw new Error(`Speed must be greater than 0 mph: ${mph}`);
  }
  return (distance / mph) * 60;
}
