/*
 * 收藏 tab: a page title, then a 6-column card grid fed live from the
 * favorites store, starting at row 0 of the tab's content group.
 */
import CardGrid from '../components/CardGrid.jsx'
import PageTitle from '../components/PageTitle.jsx'
import { useStoreValue } from '../hooks/useStore.js'
import { favoritesStore } from '../store/favorites.js'

export default function FavoritesPage({ group = 'content', onOpenDetail }) {
  const favorites = useStoreValue(favoritesStore)
  return (
    <div className="pt-4">
      <PageTitle>收藏</PageTitle>
      <CardGrid items={favorites} group={group} onOpenDetail={onOpenDetail} emptyText="还没有收藏" />
    </div>
  )
}
