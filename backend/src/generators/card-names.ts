// Country-tagged name pools. The card generator combines a random first name
// with a random last name from the same pool to keep names culturally coherent.
// Names are realistic-feeling but fictional.

export type CountryNamePool = {
  country: string
  firstNames: string[]
  lastNames: string[]
}

export const CARD_NAMES: CountryNamePool[] = [
  {
    country: 'England',
    firstNames: [
      'Harry',
      'Jack',
      'James',
      'Tom',
      'Liam',
      'Owen',
      'Daniel',
      'Marcus',
      'Phil',
      'George',
      'Reece',
      'Connor'
    ],
    lastNames: [
      'Walker',
      'Clarke',
      'Bennett',
      'Holloway',
      'Thornton',
      'Whitfield',
      'Pemberton',
      'Ashcroft',
      'Greaves',
      'Maddox',
      'Hartley',
      'Whitaker'
    ]
  },
  {
    country: 'Scotland',
    firstNames: [
      'Cameron',
      'Callum',
      'Finlay',
      'Murray',
      'Lewis',
      'Angus',
      'Ross',
      'Euan',
      'Kieran',
      'Stuart',
      'Hamish',
      'Alasdair'
    ],
    lastNames: [
      'Mackay',
      'Fraser',
      'Sinclair',
      'Buchanan',
      'Drummond',
      'Crawford',
      'MacLeod',
      'Stewart',
      'Ferguson',
      'Mclaren',
      'Ainslie',
      'Galloway'
    ]
  },
  {
    country: 'Ireland',
    firstNames: [
      'Patrick',
      'Sean',
      'Declan',
      'Niall',
      'Cillian',
      'Eoin',
      'Conor',
      'Aidan',
      'Ronan',
      'Liam',
      'Daire',
      'Oisin'
    ],
    lastNames: [
      "O'Hara",
      'Doyle',
      'Murphy',
      'Kennedy',
      'Brennan',
      'Gallagher',
      "O'Brien",
      'Donnelly',
      'Sheehan',
      'Maguire',
      'Fitzgerald',
      'Hennessy'
    ]
  },
  {
    country: 'Spain',
    firstNames: [
      'Diego',
      'Sergio',
      'Pablo',
      'Javier',
      'Marco',
      'Andres',
      'Gonzalo',
      'Rafael',
      'Hugo',
      'Iker',
      'Alvaro',
      'Adrian'
    ],
    lastNames: [
      'Hernandez',
      'Castillo',
      'Reyes',
      'Vega',
      'Cabrera',
      'Iglesias',
      'Romero',
      'Navarro',
      'Vargas',
      'Carrillo',
      'Beltran',
      'Salazar'
    ]
  },
  {
    country: 'Italy',
    firstNames: [
      'Marco',
      'Luca',
      'Matteo',
      'Alessandro',
      'Federico',
      'Stefano',
      'Andrea',
      'Davide',
      'Tommaso',
      'Riccardo',
      'Lorenzo',
      'Giovanni'
    ],
    lastNames: [
      'Rossi',
      'Conti',
      'Marino',
      'Greco',
      'Bruno',
      'Gallo',
      'Esposito',
      'Romano',
      'Bianchi',
      'Lombardi',
      'Moretti',
      'Caruso'
    ]
  },
  {
    country: 'France',
    firstNames: [
      'Hugo',
      'Mathis',
      'Theo',
      'Louis',
      'Antoine',
      'Julien',
      'Romain',
      'Maxime',
      'Florian',
      'Sebastien',
      'Clement',
      'Adrien'
    ],
    lastNames: [
      'Dubois',
      'Moreau',
      'Laurent',
      'Mercier',
      'Lemoine',
      'Fontaine',
      'Charpentier',
      'Bertrand',
      'Faure',
      'Garnier',
      'Delacroix',
      'Marchand'
    ]
  },
  {
    country: 'Germany',
    firstNames: [
      'Jonas',
      'Leon',
      'Felix',
      'Niklas',
      'Lukas',
      'Tobias',
      'Sebastian',
      'Jannik',
      'Maximilian',
      'Florian',
      'Moritz',
      'Henrik'
    ],
    lastNames: [
      'Mueller',
      'Wagner',
      'Schroeder',
      'Hoffmann',
      'Bauer',
      'Richter',
      'Becker',
      'Vogel',
      'Krause',
      'Zimmermann',
      'Brandt',
      'Kaiser'
    ]
  },
  {
    country: 'Netherlands',
    firstNames: ['Daan', 'Sven', 'Bram', 'Tim', 'Lars', 'Joost', 'Stijn', 'Mees', 'Sem', 'Ruben', 'Thijs', 'Niels'],
    lastNames: [
      'van Dijk',
      'de Jong',
      'Janssen',
      'Visser',
      'Bakker',
      'de Vries',
      'Mulder',
      'Hendriks',
      'van der Berg',
      'Vermeer',
      'Kuiper',
      'Boon'
    ]
  },
  {
    country: 'Brazil',
    firstNames: [
      'Lucas',
      'Mateus',
      'Rafael',
      'Bruno',
      'Gustavo',
      'Tiago',
      'Ricardo',
      'Felipe',
      'Eduardo',
      'Vinicius',
      'Caio',
      'Igor'
    ],
    lastNames: [
      'Silva',
      'Costa',
      'Pereira',
      'Ribeiro',
      'Almeida',
      'Cardoso',
      'Barbosa',
      'Mendes',
      'Tavares',
      'Moreira',
      'Carvalho',
      'Nogueira'
    ]
  },
  {
    country: 'Argentina',
    firstNames: [
      'Lautaro',
      'Mateo',
      'Joaquin',
      'Tomas',
      'Bautista',
      'Agustin',
      'Nicolas',
      'Emiliano',
      'Gonzalo',
      'Franco',
      'Santino',
      'Valentin'
    ],
    lastNames: [
      'Gimenez',
      'Acosta',
      'Paredes',
      'Quiroga',
      'Aguirre',
      'Maldonado',
      'Sosa',
      'Fernandez',
      'Ortega',
      'Cabrera',
      'Romero',
      'Benitez'
    ]
  },
  {
    country: 'Portugal',
    firstNames: [
      'Joao',
      'Rui',
      'Bruno',
      'Tiago',
      'Miguel',
      'Andre',
      'Diogo',
      'Goncalo',
      'Rafael',
      'Bernardo',
      'Vasco',
      'Renato'
    ],
    lastNames: [
      'Pinto',
      'Soares',
      'Carvalho',
      'Antunes',
      'Teixeira',
      'Magalhaes',
      'Cunha',
      'Baptista',
      'Faria',
      'Lourenco',
      'Pacheco',
      'Tavares'
    ]
  },
  {
    country: 'Wales',
    firstNames: [
      'Rhys',
      'Owain',
      'Gareth',
      'Dylan',
      'Iwan',
      'Cai',
      'Aled',
      'Geraint',
      'Bryn',
      'Ioan',
      'Trystan',
      'Eifion'
    ],
    lastNames: [
      'Pritchard',
      'Hughes',
      'Llewellyn',
      'Bevan',
      'Morgan',
      'Davies',
      'Powell',
      'Cadwallader',
      'Vaughan',
      'Edwards',
      'Jenkins',
      'Owen'
    ]
  }
]
