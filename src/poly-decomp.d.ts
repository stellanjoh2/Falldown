declare module "poly-decomp" {
  type Point = [number, number];
  const decomp: {
    quickDecomp(polygon: Point[]): Point[][];
    makeCCW(polygon: Point[]): void;
    removeCollinearPoints(polygon: Point[], threshold: number): void;
    removeDuplicatePoints(polygon: Point[], threshold: number): void;
    isSimple(polygon: Point[]): boolean;
  };
  export default decomp;
}
