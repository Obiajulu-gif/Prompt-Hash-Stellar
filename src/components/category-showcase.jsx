import { Button } from "./ui/button";
import { Link } from "react-router-dom";

const showcaseCategories = [
  { name: "Software Development", slug: "software-development", count: 42, image: "/images/code&dev.png" },
  { name: "Marketing", slug: "marketing", count: 38, image: "/images/marketing.png" },
  { name: "Creative", slug: "creative", count: 27, image: "/images/text&writing.png" },
  { name: "Sales", slug: "sales", count: 19, image: "/images/sales.png" },
];

export function CategoryShowcase() {
  return (
    <section className="py-16 px-6 bg-gray-950">
      <div className="mx-auto max-w-7xl">
        <h2 className="text-2xl font-bold tracking-tight text-white mb-8">
          Explore Categories
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {showcaseCategories.map((category) => (
            <Link to={`/category/${category.slug}`} key={category.slug}>
              <div className="relative group overflow-hidden rounded-lg">
                <div className="aspect-[4/3] overflow-hidden">
                  <img
                    src={category.image || "/placeholder.svg"}
                    alt={category.name}
                    className="object-cover w-full h-full transition-transform group-hover:scale-105"
                  />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex flex-col justify-end p-4">
                  <h3 className="text-lg font-semibold text-white">
                    {category.name}
                  </h3>
                  <p className="text-sm text-gray-300">
                    {category.count} prompts
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link to="/browse">
            <Button className="bg-purple-600 hover:bg-purple-700">
              View All Categories
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
