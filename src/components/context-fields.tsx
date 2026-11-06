// HYG-009 B2-1: the context the page was rendered in, posted with every clinic write form and
// compared with the freshly resolved context by the action (staleContext). Expectation only.
import type { RenderedContext } from "../modules/org/context/context";

export function ContextFields({ ctx }: { ctx: RenderedContext }) {
  return (
    <>
      <input type="hidden" name="ctx_t" value={ctx.t} />
      <input type="hidden" name="ctx_r" value={ctx.r} />
      <input type="hidden" name="ctx_b" value={ctx.b} />
    </>
  );
}
