import { createContext, useContext } from "react";

/**
 * Lets custom node components reach back to the canvas to commit an inline
 * rename, without threading callbacks through the immutable layout `data`.
 * Canvas wraps <ReactFlow> in the Provider; nodes render inside that tree.
 */
export interface NodeEditApi {
  renameNode: (nodeId: string, label: string) => void;
}

export const NodeEditContext = createContext<NodeEditApi>({
  renameNode: () => {},
});

export function useNodeEdit(): NodeEditApi {
  return useContext(NodeEditContext);
}
