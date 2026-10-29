import Placeholder from '../components/Placeholder.jsx'
import { getCategory } from '../config/taxonomy.js'

// Placeholder until M2-4.
export default function CategoryPage({ category }) {
  return <Placeholder title={getCategory(category)?.name} />
}
