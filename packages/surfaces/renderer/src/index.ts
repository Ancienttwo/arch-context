import type { RendererPort } from "@archcontext/contracts";
import {
  exportMermaidModel,
  normalizeNativeModel,
  type NativeNode
} from "@archcontext/core/projection-engine";

export * from "@archcontext/core/projection-engine";

export class NativeRenderer implements RendererPort {
  async renderProjection(input: { modelDigest: string; model: unknown[] }) {
    const model = normalizeNativeModel({ nodes: input.model as NativeNode[], relations: [] });
    return exportMermaidModel(model).files;
  }
}
