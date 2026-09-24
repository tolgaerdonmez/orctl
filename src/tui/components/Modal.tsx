import { useTerminalDimensions } from "@opentui/react";
import type { ReactNode } from "react";
import { Layer, useKeys } from "../state.tsx";
import { theme } from "../theme.ts";

/**
 * Centered overlay. While open it swallows every key in the router (content components register
 * above Layer.MODAL to receive them first); escape closes it.
 */
export function Modal(props: {
  title: string;
  width?: number;
  height?: number;
  onClose(): void;
  children: ReactNode;
  borderColor?: string;
}) {
  const dims = useTerminalDimensions();
  const width = Math.min(props.width ?? 64, Math.max(20, dims.width - 4));
  const height = Math.min(props.height ?? 14, Math.max(6, dims.height - 2));
  useKeys((id) => {
    if (id === "escape") props.onClose();
    return id !== "ctrl+c";
  }, Layer.MODAL);
  return (
    <box
      position="absolute"
      left={Math.max(0, Math.floor((dims.width - width) / 2))}
      top={Math.max(0, Math.floor((dims.height - height) / 2))}
      width={width}
      height={height}
      zIndex={100}
      border
      borderStyle="rounded"
      borderColor={props.borderColor ?? theme.accent}
      backgroundColor={theme.modalBg}
      title={` ${props.title} `}
      flexDirection="column"
      paddingX={1}
    >
      {props.children}
    </box>
  );
}

/** Priority for key handlers of components rendered inside a modal. */
export const MODAL_CONTENT = Layer.MODAL + 1;
