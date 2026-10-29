// Page header for the personal tabs. The title takes a home shelf's row-title
// treatment, so 收藏 on its own tab reads like 我的收藏 on the home page; the
// row has a fixed height so every tab's content starts at the same y whether
// or not it carries actions.
export default function PageTitle({ actions, children }) {
  return (
    <div className="mb-[18px] flex h-[54px] items-center gap-5">
      <h2 className="text-heading font-semibold text-fg">{children}</h2>
      {actions}
    </div>
  )
}
