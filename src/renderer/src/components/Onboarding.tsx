import { Check, Plus } from 'lucide-react'
import { Button } from './ui/button'
import { MonoLine } from './StatePanel'

/** First run: no hosts yet. Walks through what the sandbox needs before adding it. */
export function Onboarding({ onAddHost }: { onAddHost(): void }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-4 py-10">
      <div className="flex w-full max-w-140 flex-col gap-7">
        <div className="flex flex-col gap-2.5">
          <h1 className="text-[28px] font-semibold tracking-[-0.01em]">Add your first sandbox</h1>
          <p className="text-sm/[1.55] text-muted-foreground">
            remodeck runs git and Docker on a Linux host over SSH. Pushes go out from this PC, so
            the sandbox never holds a GitHub credential.
          </p>
        </div>

        <ol className="flex flex-col overflow-hidden rounded-xl border border-border bg-background">
          <li className="flex gap-3.5 border-b border-border p-4 last:border-b-0">
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success-soft text-success"
            >
              <Check size={13} strokeWidth={2.6} />
            </span>
            <div className="flex flex-1 flex-col gap-1">
              <span className="font-medium">An SSH alias that works</span>
              <span className="text-muted-foreground">
                Add it to <MonoLine>~/.ssh/config</MonoLine> so{' '}
                <MonoLine>ssh &lt;alias&gt;</MonoLine> connects with your agent key.
              </span>
            </div>
          </li>
          <li className="flex gap-3.5 border-b border-border p-4 last:border-b-0">
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
            >
              2
            </span>
            <div className="flex flex-1 flex-col gap-1">
              <span className="font-medium">git on the sandbox</span>
              <span className="text-muted-foreground">
                remodeck doesn’t install anything there. We check for git when you connect.
              </span>
            </div>
          </li>
          <li className="flex gap-3.5 p-4">
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
            >
              3
            </span>
            <div className="flex flex-1 flex-col gap-2">
              <span className="font-medium">GitHub login on this PC</span>
              <MonoLine tone="command">git credential-manager github login</MonoLine>
            </div>
          </li>
        </ol>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={onAddHost}>
            <Plus aria-hidden="true" />
            Add host
          </Button>
        </div>
      </div>
    </div>
  )
}
