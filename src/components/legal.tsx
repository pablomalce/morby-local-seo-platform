/**
 * Shared primitives for the /legal/* pages. Vulkan styled but readable — these documents are
 * meant to be skimmable.
 */

export function LegalHeader({
  eyebrow,
  title,
  effective,
}: {
  eyebrow: string;
  title: string;
  effective: string;
}) {
  return (
    <header className="mb-10 border-b border-metal-800 pb-6">
      <p className="font-mono text-[10px] uppercase tracking-hud text-vulkan-orange">
        <span className="text-vulkan-orange">//</span> {eyebrow}
      </p>
      <h1 className="mt-3 display-h text-4xl md:text-5xl">{title}</h1>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-hud text-metal-500">
        Effective {effective}
      </p>
    </header>
  );
}

export function LegalSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="display-h text-lg">
        <span className="mr-3 text-vulkan-orange">{number}</span>
        {title}
      </h2>
      <div className="prose prose-invert mt-4 max-w-none text-[14px] leading-relaxed text-metal-300 space-y-3">
        {children}
      </div>
    </section>
  );
}

export function LegalNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-vulkan border-l-2 border-vulkan-orange bg-metal-950 p-4 text-[13px] text-metal-300">
      {children}
    </div>
  );
}

export function LegalList({ items }: { items: (string | React.ReactNode)[] }) {
  return (
    <ul className="space-y-2 text-[13px] text-metal-300">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-vulkan-orange" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
