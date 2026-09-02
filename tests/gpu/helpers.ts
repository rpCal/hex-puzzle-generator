import { PIECE_DATA_STRIDE } from '@core/cut/mesh.ts';

export { Renderer } from '@gfx/renderer.ts';

/** Floats per `PieceData` entry, for indexing the buffer read back in tests. */
export const PIECE_DATA_STRIDE_FLOATS_FOR_TEST = PIECE_DATA_STRIDE / 4;
