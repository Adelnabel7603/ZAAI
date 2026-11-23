const zaaiCatalogImageGalleries = {
  royal: [
    "image/man/ازرق ملكي/ازرق ملكي.webp",
    "image/man/ازرق ملكي/1.png",
    "image/man/ازرق ملكي/2.png",
    "image/man/ازرق ملكي/3.png",
    "image/man/ازرق ملكي/طبيب بزي أزرق ملكي.webp"
  ],
  sky: [
    "image/man/ازرق سماوي/سماوي.webp",
    "image/man/ازرق سماوي/1.png",
    "image/man/ازرق سماوي/2.png",
    "image/man/ازرق سماوي/3.png",
    "image/man/ازرق سماوي/طبيبي بالأزرق السماوي.webp"
  ],
  black: [
    "image/man/اسود/اسود.webp",
    "image/man/اسود/1.png",
    "image/man/اسود/2.png",
    "image/man/اسود/جيب بنطال أسود مع علبة سماعات.webp",
    "image/man/اسود/طبيب بزي أسود.webp"
  ],
  wine: [
    "image/man/النبيتي البنفسجي الداكن/النبيتي البنفسجي الداكن.webp",
    "image/man/النبيتي البنفسجي الداكن/1.jpg",
    "image/man/النبيتي البنفسجي الداكن/2.jpg",
    "image/man/النبيتي البنفسجي الداكن/3.jpg",
    "image/man/النبيتي البنفسجي الداكن/4.jpg"
  ],
  slate: [
    "image/man/رمادي مزرق/رمادي مزرق.webp",
    "image/man/رمادي مزرق/1.png",
    "image/man/رمادي مزرق/2.png",
    "image/man/رمادي مزرق/جيب بنطال طبي رمادي أزرق مع إكسسوارات.webp",
    "image/man/رمادي مزرق/طبيب بزي أزرق رمادي.webp"
  ],
  "light-royal": [
    "image/man/ازرق ملكي فاتح/ازرق ملكي فاتح .webp",
    "image/man/ازرق ملكي فاتح/1.png",
    "image/man/ازرق ملكي فاتح/2.png",
    "image/man/ازرق ملكي فاتح/جيب أزرق نابض مع جهاز معدني.webp",
    "image/man/ازرق ملكي فاتح/طبيب بزي أزرق ملكي فاتح .webp"
  ]
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = zaaiCatalogImageGalleries;
} else {
  globalThis.ZAAI_CATALOG_IMAGE_GALLERIES = zaaiCatalogImageGalleries;
}
