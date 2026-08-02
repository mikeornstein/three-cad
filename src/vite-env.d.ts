/// <reference types="vite/client" />

declare module "manifold-3d" {
  // Minimal typing for the default WASM module export we use.
  // Full library types live next to the package; skipLibCheck is on.
  type Vec3 = [number, number, number] | number[];

  interface ManifoldMesh {
    numProp: number;
    numVert: number;
    numTri: number;
    vertProperties: Float32Array;
    triVerts: Uint32Array;
  }

  interface ManifoldSolid {
    add(other: ManifoldSolid): ManifoldSolid;
    translate(offset: Vec3): ManifoldSolid;
    getMesh(normalIdx?: number): ManifoldMesh;
    delete(): void;
  }

  interface ManifoldStatic {
    cube(size?: Vec3 | number, center?: boolean): ManifoldSolid;
    sphere(radius: number, circularSegments?: number): ManifoldSolid;
  }

  interface ManifoldModule {
    setup(): void;
    Manifold: ManifoldStatic;
  }

  export default function Module(args?: {
    locateFile?: (path: string, scriptDirectory?: string) => string;
  }): Promise<ManifoldModule>;
}

declare module "manifold-3d/manifold.wasm?url" {
  const url: string;
  export default url;
}
