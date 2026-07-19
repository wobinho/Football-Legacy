// Name pools + fictional club definitions for the world generator (§12).
// v1 ships a fictional world; the CSV importer for real-player datasets is a
// separate module that writes into the same schema.

export interface NamePool {
  nat: string; // 3-letter code
  first: string[];
  last: string[];
}

export const NAME_POOLS: NamePool[] = [
  {
    nat: "ENG",
    first: ["Jack", "Harry", "Ollie", "George", "Charlie", "Alfie", "Lewis", "Mason", "Callum", "Kyle", "Jordan", "Reece", "Ben", "Sam", "Joe", "Tom", "Luke", "Ryan", "Aaron", "Connor", "Dan", "Nathan", "Jake", "Liam", "Owen", "Theo", "Marcus", "Dominic", "Ashley", "Kieran", "Declan", "Cole", "Freddie", "Archie", "Louie", "Jude", "Kobe", "Rio", "Trent", "Bobby"],
    last: ["Smith", "Walker", "Turner", "Wright", "Clarke", "Hughes", "Barnes", "Palmer", "Foster", "Chapman", "Bennett", "Osborne", "Whitfield", "Mercer", "Hartley", "Doyle", "Sutton", "Kendall", "Brooks", "Fletcher", "Marsh", "Winter", "Ashworth", "Fenton", "Radcliffe", "Holloway", "Prescott", "Stanton", "Bellamy", "Croft", "Ainsworth", "Blakemore", "Ellison", "Garner", "Hodgson", "Ingram", "Loxley", "Norwood", "Pemberton", "Quinn", "Rowntree", "Selby", "Thorne", "Underhill", "Vickers", "Wetherby", "Yardley", "Redfern"],
  },
  {
    nat: "ESP",
    first: ["Pablo", "Alvaro", "Sergio", "Iker", "Dani", "Marcos", "Adrian", "Hugo", "Mario", "Diego", "Javi", "Carlos", "Ruben", "Nacho", "Pedro", "Unai", "Mikel", "Ander", "Gorka", "Raul"],
    last: ["Garcia", "Fernandez", "Lopez", "Martinez", "Sanchez", "Torres", "Navarro", "Iglesias", "Vidal", "Herrera", "Castillo", "Moreno", "Serrano", "Ortega", "Delgado", "Vega", "Fuentes", "Salazar", "Campos", "Rojas"],
  },
  {
    nat: "ITA",
    first: ["Marco", "Luca", "Matteo", "Alessandro", "Davide", "Federico", "Lorenzo", "Andrea", "Simone", "Riccardo", "Nicolo", "Gabriele", "Antonio", "Giacomo", "Tommaso"],
    last: ["Rossi", "Bianchi", "Romano", "Ferrari", "Esposito", "Ricci", "Marino", "Greco", "Conti", "DeLuca", "Mancini", "Costa", "Giordano", "Rizzo", "Lombardi", "Moretti", "Barbieri", "Fontana", "Santoro", "Marchetti"],
  },
  {
    nat: "GER",
    first: ["Lukas", "Leon", "Finn", "Jonas", "Niklas", "Tim", "Felix", "Maximilian", "Paul", "Moritz", "Jan", "Florian", "Tobias", "Erik", "Nico"],
    last: ["Muller", "Schmidt", "Fischer", "Weber", "Wagner", "Becker", "Hoffmann", "Schulz", "Koch", "Richter", "Klein", "Wolf", "Neumann", "Braun", "Zimmermann", "Kruger", "Hartmann", "Lange", "Werner", "Krause"],
  },
  {
    nat: "FRA",
    first: ["Lucas", "Hugo", "Theo", "Antoine", "Kylian", "Ousmane", "Jules", "Leo", "Mathis", "Nolan", "Enzo", "Rayan", "Yanis", "Axel", "Maxime"],
    last: ["Martin", "Bernard", "Dubois", "Petit", "Durand", "Leroy", "Moreau", "Fournier", "Girard", "Lambert", "Mercier", "Blanc", "Henry", "Rousseau", "Mathieu", "Gauthier", "Perrin", "Chevalier", "Marchand", "Dupont"],
  },
  {
    nat: "BRA",
    first: ["Gabriel", "Matheus", "Vinicius", "Rafael", "Thiago", "Bruno", "Caio", "Felipe", "Gustavo", "Joao", "Pedro", "Luan", "Igor", "Wesley", "Everton"],
    last: ["Silva", "Santos", "Oliveira", "Souza", "Lima", "Pereira", "Costa", "Ferreira", "Almeida", "Nascimento", "Araujo", "Ribeiro", "Carvalho", "Gomes", "Martins", "Rocha", "Barbosa", "Moura", "Cardoso", "Teixeira"],
  },
  {
    nat: "NED",
    first: ["Daan", "Sem", "Lars", "Thijs", "Ruben", "Jesse", "Sven", "Niels", "Bram", "Timo", "Joris", "Wout", "Kees", "Pim", "Stijn"],
    last: ["DeJong", "VanDijk", "Bakker", "Visser", "Smit", "Meijer", "DeBoer", "Mulder", "Bos", "Vos", "Peters", "Hendriks", "VanLeeuwen", "Dekker", "Brouwer", "DeWit", "Dijkstra", "Smeets", "VanDenBerg", "Kuipers"],
  },
  {
    nat: "NGA",
    first: ["Chidi", "Emeka", "Kelechi", "Obi", "Samuel", "Victor", "Wilfred", "Ade", "Femi", "Tunde", "Sola", "Ike", "Nnamdi", "Uche", "Zik"],
    last: ["Okafor", "Okonkwo", "Adeyemi", "Balogun", "Chukwu", "Eze", "Ibrahim", "Lawal", "Nwosu", "Obi", "Ogunleye", "Okoro", "Olawale", "Onyeka", "Udo", "Umar", "Yusuf", "Abubakar", "Danjuma", "Musa"],
  },
  {
    nat: "SWE",
    first: ["Erik", "Oskar", "Viktor", "Axel", "Elias", "Emil", "Filip", "Gustav", "Hugo", "Isak", "Anton", "Ludvig", "Melker", "Nils", "Alvin"],
    last: ["Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson", "Svensson", "Gustafsson", "Pettersson", "Jonsson", "Jansson", "Hansson", "Bengtsson", "Lindberg", "Lindqvist", "Berg", "Sandberg", "Forsberg"],
  },
  {
    nat: "ARG",
    first: ["Santiago", "Mateo", "Joaquin", "Facundo", "Agustin", "Lautaro", "Franco", "Nicolas", "Ezequiel", "Gonzalo", "Julian", "Ramiro", "Tomas", "Valentin", "Bautista"],
    last: ["Gonzalez", "Rodriguez", "Gomez", "Diaz", "Alvarez", "Romero", "Benitez", "Acosta", "Medina", "Herrera", "Aguirre", "Molina", "Ortiz", "Silva", "Rojas", "Ledesma", "Paredes", "Sosa", "Villalba", "Cabrera"],
  },
  {
    nat: "POR",
    first: ["Joao", "Diogo", "Goncalo", "Tiago", "Andre", "Ruben", "Bernardo", "Rafael", "Bruno", "Nuno", "Vitor", "Fabio", "Ricardo", "Duarte", "Afonso"],
    last: ["Silva", "Santos", "Ferreira", "Pereira", "Oliveira", "Costa", "Rodrigues", "Martins", "Fernandes", "Goncalves", "Lopes", "Marques", "Sousa", "Carvalho", "Ramos", "Pinto", "Teixeira", "Moreira", "Correia", "Neves"],
  },
  {
    nat: "TUR",
    first: ["Emre", "Burak", "Hakan", "Cengiz", "Kerem", "Arda", "Yusuf", "Mert", "Ozan", "Berat", "Kaan", "Salih", "Ferdi", "Baris", "Halil"],
    last: ["Yilmaz", "Kaya", "Demir", "Sahin", "Celik", "Aydin", "Ozturk", "Arslan", "Dogan", "Kilic", "Aslan", "Cetin", "Kara", "Koc", "Kurt", "Ozdemir", "Polat", "Erdogan", "Yildiz", "Aktas"],
  },
  {
    nat: "USA",
    first: ["Tyler", "Brandon", "Austin", "Landon", "Chris", "Josh", "Zack", "Caleb", "Brian", "Devon", "Trevor", "Cade", "Logan", "Hunter", "Weston"],
    last: ["Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson", "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Martin", "Harris", "Thompson", "Robinson", "Clark", "Lewis", "Hall", "Young"],
  },
  {
    nat: "BEL",
    first: ["Thibaut", "Kevin", "Youri", "Axel", "Wout", "Timothy", "Arthur", "Maxim", "Bryan", "Jens", "Sander", "Dries", "Lukas", "Milan", "Senne"],
    last: ["Peeters", "Janssens", "Maes", "Jacobs", "Mertens", "Willems", "Claes", "Goossens", "Wouters", "DeSmet", "Dubois", "Lambert", "Dupont", "Simon", "Martens", "Michiels", "VanDamme", "Segers", "Hendrickx", "Lemmens"],
  },
  {
    nat: "SUI",
    first: ["Granit", "Remo", "Silvan", "Noah", "Cedric", "Fabian", "Michel", "Renato", "Dan", "Luca", "Andrin", "Nico", "Joel", "Marco", "Yann"],
    last: ["Muller", "Meier", "Schmid", "Keller", "Weber", "Huber", "Schneider", "Steiner", "Frei", "Baumann", "Brunner", "Gerber", "Widmer", "Zimmermann", "Moser", "Graf", "Wyss", "Roth", "Suter", "Bachmann"],
  },
  {
    nat: "AUT",
    first: ["Marcel", "David", "Konrad", "Stefan", "Xaver", "Christoph", "Marko", "Patrick", "Michael", "Romano", "Nikolaus", "Maximilian", "Philipp", "Sasa", "Alexander"],
    last: ["Gruber", "Huber", "Bauer", "Wagner", "Pichler", "Steiner", "Moser", "Mayer", "Hofer", "Leitner", "Berger", "Fuchs", "Eder", "Fischer", "Schmid", "Winkler", "Weber", "Schwarz", "Maier", "Lang"],
  },
  {
    nat: "CRO",
    first: ["Luka", "Mateo", "Ivan", "Marcelo", "Josko", "Ante", "Lovro", "Mario", "Nikola", "Borna", "Duje", "Marin", "Petar", "Toni", "Kristijan"],
    last: ["Horvat", "Kovacevic", "Babic", "Maric", "Juric", "Novak", "Kovacic", "Knezevic", "Vukovic", "Markovic", "Petrovic", "Matic", "Tomic", "Pavlovic", "Simic", "Blazevic", "Grgic", "Radic", "Perisic", "Brozovic"],
  },
  {
    nat: "CZE",
    first: ["Tomas", "Patrik", "Ondrej", "Ladislav", "Vaclav", "Lukas", "Adam", "David", "Jan", "Matej", "Pavel", "Antonin", "Michal", "Jakub", "Vladimir"],
    last: ["Novak", "Svoboda", "Novotny", "Dvorak", "Cerny", "Prochazka", "Kucera", "Vesely", "Horak", "Nemec", "Pokorny", "Marek", "Pospisil", "Hajek", "Kral", "Jelinek", "Ruzicka", "Benes", "Fiala", "Sedlacek"],
  },
  {
    nat: "DEN",
    first: ["Christian", "Pierre", "Andreas", "Mikkel", "Rasmus", "Kasper", "Simon", "Joakim", "Jonas", "Morten", "Frederik", "Victor", "Jesper", "Oliver", "Mads"],
    last: ["Jensen", "Nielsen", "Hansen", "Pedersen", "Andersen", "Christensen", "Larsen", "Sorensen", "Rasmussen", "Jorgensen", "Petersen", "Madsen", "Kristensen", "Olsen", "Thomsen", "Christiansen", "Poulsen", "Johansen", "Mortensen", "Eriksen"],
  },
  {
    nat: "NOR",
    first: ["Erling", "Martin", "Sander", "Kristian", "Fredrik", "Morten", "Jorgen", "Sondre", "Marius", "Andreas", "Magnus", "Ola", "Eirik", "Haakon", "Sigurd"],
    last: ["Hansen", "Johansen", "Olsen", "Larsen", "Andersen", "Pedersen", "Nilsen", "Kristiansen", "Jensen", "Karlsen", "Johnsen", "Pettersen", "Eriksen", "Berg", "Haugen", "Hagen", "Johannessen", "Andreassen", "Jacobsen", "Dahl"],
  },
  {
    nat: "SCO",
    first: ["Callum", "Andy", "Scott", "Kieran", "Ryan", "Stuart", "John", "Billy", "Lewis", "Angus", "Fraser", "Craig", "Ewan", "Blair", "Cameron"],
    last: ["MacDonald", "Campbell", "Stewart", "Robertson", "Ferguson", "McGregor", "Fraser", "Sinclair", "Douglas", "Murray", "Bruce", "Wallace", "Hamilton", "Boyd", "Burns", "McLean", "Grant", "Kerr", "Duncan", "Ross"],
  },
  {
    nat: "GRE",
    first: ["Giorgos", "Kostas", "Dimitris", "Anastasios", "Petros", "Vangelis", "Christos", "Fotis", "Nikos", "Sotiris", "Panagiotis", "Thanasis", "Manolis", "Stavros", "Lefteris"],
    last: ["Papadopoulos", "Papadakis", "Georgiou", "Nikolaidis", "Ioannou", "Vlachos", "Angelopoulos", "Antoniou", "Makris", "Alexiou", "Economou", "Karagounis", "Christodoulou", "Dimitriou", "Fotopoulos", "Katsaros", "Lambros", "Manolas", "Petridis", "Samaras"],
  },
  {
    nat: "POL",
    first: ["Robert", "Piotr", "Wojciech", "Kamil", "Krzysztof", "Jakub", "Karol", "Mateusz", "Sebastian", "Przemyslaw", "Bartosz", "Nicola", "Michal", "Damian", "Arkadiusz"],
    last: ["Nowak", "Kowalski", "Wisniewski", "Wojcik", "Kowalczyk", "Kaminski", "Lewandowski", "Zielinski", "Szymanski", "Wozniak", "Dabrowski", "Kozlowski", "Jankowski", "Mazur", "Kwiatkowski", "Krawczyk", "Piotrowski", "Grabowski", "Zajac", "Pawlowski"],
  },
  {
    nat: "ROU",
    first: ["Andrei", "Razvan", "Florin", "Nicolae", "Ianis", "Dennis", "Valentin", "Darius", "Alexandru", "Octavian", "Radu", "Mihai", "Stefan", "Cristian", "Vlad"],
    last: ["Popescu", "Ionescu", "Popa", "Stan", "Dumitrescu", "Stoica", "Gheorghe", "Constantin", "Marin", "Radu", "Munteanu", "Matei", "Lazar", "Ciobanu", "Rusu", "Florea", "Barbu", "Nistor", "Preda", "Dragomir"],
  },
  {
    nat: "SRB",
    first: ["Dusan", "Aleksandar", "Sergej", "Filip", "Nemanja", "Strahinja", "Sasa", "Andrija", "Lazar", "Marko", "Nikola", "Vanja", "Stefan", "Milos", "Luka"],
    last: ["Jovanovic", "Petrovic", "Nikolic", "Markovic", "Djordjevic", "Stojanovic", "Ilic", "Stankovic", "Pavlovic", "Milosevic", "Todorovic", "Ristic", "Kostic", "Savic", "Popovic", "Radovanovic", "Zivkovic", "Mitrovic", "Vasic", "Lukic"],
  },
  {
    nat: "RUS",
    first: ["Aleksandr", "Artem", "Daniil", "Matvey", "Igor", "Sergey", "Dmitri", "Anton", "Maksim", "Ivan", "Nikita", "Roman", "Andrey", "Kirill", "Pavel"],
    last: ["Ivanov", "Smirnov", "Kuznetsov", "Popov", "Vasilyev", "Petrov", "Sokolov", "Mikhailov", "Novikov", "Fedorov", "Morozov", "Volkov", "Alekseev", "Lebedev", "Semenov", "Egorov", "Pavlov", "Kozlov", "Stepanov", "Nikolaev"],
  },
  {
    nat: "UKR",
    first: ["Andriy", "Oleksandr", "Mykhailo", "Ruslan", "Vitaliy", "Taras", "Serhiy", "Illia", "Artem", "Bohdan", "Denys", "Yevhen", "Nazar", "Vladyslav", "Dmytro"],
    last: ["Shevchenko", "Kovalenko", "Bondarenko", "Tkachenko", "Kravchenko", "Boyko", "Melnyk", "Shevchuk", "Polishchuk", "Lysenko", "Rudenko", "Savchenko", "Petrenko", "Marchenko", "Pavlenko", "Kharchenko", "Moroz", "Klymenko", "Tymoshenko", "Zinchenko"],
  },
  {
    nat: "JPN",
    first: ["Takefusa", "Kaoru", "Ritsu", "Wataru", "Daichi", "Hiroki", "Takumi", "Yuto", "Kenta", "Shoya", "Ayase", "Reo", "Sota", "Koki", "Haruya"],
    last: ["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato", "Yoshida", "Yamada", "Sasaki", "Yamaguchi", "Matsumoto", "Inoue", "Kimura", "Hayashi", "Shimizu", "Endo"],
  },
  {
    nat: "KOR",
    first: ["Min-jae", "Heung-min", "Kang-in", "Woo-young", "Jae-sung", "In-beom", "Gue-sung", "Hyun-woo", "Seung-ho", "Ji-sung", "Young-woo", "Tae-hwan", "Dong-hyun", "Sang-ho", "Jun-ho"],
    last: ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim", "Han", "Oh", "Seo", "Shin", "Kwon", "Hwang", "Ahn", "Song", "Yoo", "Hong"],
  },
  {
    nat: "KSA",
    first: ["Salem", "Firas", "Saleh", "Sami", "Yasser", "Abdullah", "Mohammed", "Fahad", "Nawaf", "Saud", "Khalid", "Turki", "Nasser", "Hattan", "Ali"],
    last: ["AlDawsari", "AlBuraikan", "AlShehri", "AlNajei", "AlGhannam", "AlBulaihi", "AlAmri", "AlFaraj", "AlMalki", "AlOtaibi", "AlHarbi", "AlQahtani", "AlMutairi", "AlShammari", "AlZahrani", "AlGhamdi", "AlJuwayr", "AlOboud", "AlHassan", "AlSahafi"],
  },
  {
    nat: "MEX",
    first: ["Hirving", "Raul", "Edson", "Cesar", "Orbelin", "Uriel", "Luis", "Erick", "Jorge", "Alexis", "Diego", "Carlos", "Fernando", "Emilio", "Santiago"],
    last: ["Hernandez", "Garcia", "Martinez", "Lopez", "Gonzalez", "Perez", "Rodriguez", "Sanchez", "Ramirez", "Cruz", "Flores", "Gomez", "Vargas", "Jimenez", "Reyes", "Torres", "Aguilar", "Mendoza", "Guzman", "Ochoa"],
  },
  {
    nat: "COL",
    first: ["Luis", "Juan", "Rafael", "Duvan", "Wilmar", "Davinson", "Yerry", "Mateus", "Jhon", "Camilo", "Kevin", "Deiver", "Jorman", "Santiago", "Andres"],
    last: ["Diaz", "Cuadrado", "Borja", "Zapata", "Barrios", "Sanchez", "Mina", "Uribe", "Arias", "Vargas", "Castano", "Machado", "Campaz", "Quintero", "Mojica", "Cardona", "Lerma", "Muriel", "Ospina", "Perea"],
  },
  {
    nat: "AUS",
    first: ["Harry", "Mathew", "Jackson", "Aiden", "Riley", "Connor", "Denis", "Aziz", "Craig", "Cameron", "Jamie", "Marco", "Kye", "Nestory", "Brandon"],
    last: ["Souttar", "Ryan", "Irvine", "Goodwin", "McGree", "Metcalfe", "Genreau", "Behich", "Duke", "Devlin", "Maclaren", "Tilio", "Rowles", "Mabil", "Borrello", "Hrustic", "Boyle", "King", "Strain", "Bos"],
  },
];

export function poolFor(nat: string): NamePool {
  return NAME_POOLS.find((p) => p.nat === nat) ?? NAME_POOLS[0];
}

// ── Fictional clubs ───────────────────────────────────────────────────────
// rep = baseline reputation (1-100); tiers within divisions create texture.

export interface ClubDef {
  name: string;
  short: string;
  colors: [string, string];
  rep: number;
  stadium: string;
}

export const ENGLAND_D1: ClubDef[] = [
  { name: "London Imperial", short: "LIM", colors: ["#1b458f", "#ffffff"], rep: 88, stadium: "The Crown Ground" },
  { name: "Manchester Athletic", short: "MAN", colors: ["#6cabdd", "#1c2c5b"], rep: 90, stadium: "Irwell Park" },
  { name: "Merseyside Rovers", short: "MER", colors: ["#c8102e", "#f6eb61"], rep: 89, stadium: "Anchor Road" },
  { name: "North London Arsenal Works", short: "NLW", colors: ["#ef0107", "#ffffff"], rep: 86, stadium: "The Foundry" },
  { name: "West London Chelsom", short: "WLC", colors: ["#034694", "#dba111"], rep: 85, stadium: "Kings Meadow" },
  { name: "Tyneside United", short: "TYN", colors: ["#241f20", "#ffffff"], rep: 80, stadium: "Gallowgate Field" },
  { name: "Birmingham Villans", short: "BIR", colors: ["#670e36", "#95bfe5"], rep: 79, stadium: "Heartlands Park" },
  { name: "East London Irons", short: "ELI", colors: ["#7a263a", "#1bb1e7"], rep: 76, stadium: "Docklands Stadium" },
  { name: "Brighton Seagulls", short: "BSG", colors: ["#0057b8", "#ffffff"], rep: 74, stadium: "Cliffside Arena" },
  { name: "Nottingham Foresters", short: "NOT", colors: ["#dd0000", "#ffffff"], rep: 72, stadium: "Sherwood Ground" },
  { name: "Leeds Peacocks", short: "LEE", colors: ["#ffffff", "#1d428a"], rep: 73, stadium: "Elland Meadow" },
  { name: "Everley Blues", short: "EVE", colors: ["#003399", "#ffffff"], rep: 75, stadium: "Mersey Bank" },
  { name: "Wolverton Wanderers", short: "WOL", colors: ["#fdb913", "#231f20"], rep: 70, stadium: "Molyneux Field" },
  { name: "Leicester Foxhounds", short: "LEI", colors: ["#003090", "#fdbe11"], rep: 71, stadium: "Filbert Park" },
  { name: "Crystal Palisade", short: "CPL", colors: ["#1b458f", "#c4122e"], rep: 69, stadium: "Selhurst Rise" },
  { name: "Fulwell Cottagers", short: "FUL", colors: ["#ffffff", "#000000"], rep: 68, stadium: "Riverside Cottage" },
  { name: "Bournewood Cherries", short: "BOU", colors: ["#da291c", "#000000"], rep: 66, stadium: "Vitality Cove" },
  { name: "Brentley Bees", short: "BRE", colors: ["#e30613", "#fbb800"], rep: 65, stadium: "Hive Lane" },
  { name: "Southgate Saints", short: "SOU", colors: ["#d71920", "#ffffff"], rep: 67, stadium: "Marchwood Dell" },
  { name: "Sheffield Steel", short: "SHE", colors: ["#ee2737", "#ffffff"], rep: 64, stadium: "Bramall Furnace" },
];

export const ENGLAND_D2: ClubDef[] = [
  { name: "Sunderland Mariners", short: "SUN", colors: ["#eb172b", "#ffffff"], rep: 60, stadium: "Wearside Light" },
  { name: "Middlesbrough Ironopolis", short: "MID", colors: ["#e11b22", "#ffffff"], rep: 58, stadium: "Riverside Works" },
  { name: "Norwich Canaries", short: "NOR", colors: ["#fff200", "#00a650"], rep: 57, stadium: "Carrow Meadow" },
  { name: "Watford Hornets", short: "WAT", colors: ["#fbee23", "#ed2127"], rep: 56, stadium: "Vicarage Lane" },
  { name: "Coventry Skyblues", short: "COV", colors: ["#87b3e0", "#ffffff"], rep: 55, stadium: "Ricoh Fields" },
  { name: "West Bromley Baggies", short: "WBB", colors: ["#122f67", "#ffffff"], rep: 56, stadium: "Hawthorn Green" },
  { name: "Stoke Potters", short: "STO", colors: ["#e03a3e", "#ffffff"], rep: 54, stadium: "Trentside Kiln" },
  { name: "Hull Tigers", short: "HUL", colors: ["#f5971d", "#000000"], rep: 52, stadium: "Humber Park" },
  { name: "Swansea Swans", short: "SWA", colors: ["#ffffff", "#000000"], rep: 53, stadium: "Liberty Bay" },
  { name: "Cardiff Bluebirds", short: "CAR", colors: ["#0070b5", "#d61e49"], rep: 52, stadium: "Taff Bank" },
  { name: "Bristol Robins", short: "BRI", colors: ["#e21c38", "#ffffff"], rep: 51, stadium: "Ashton Vale" },
  { name: "Preston Lilywhites", short: "PRE", colors: ["#ffffff", "#001f5c"], rep: 50, stadium: "Deepdale Green" },
  { name: "Blackburn Riversiders", short: "BLA", colors: ["#009ee0", "#ffffff"], rep: 51, stadium: "Ewood Bank" },
  { name: "Derby Rams", short: "DER", colors: ["#ffffff", "#000000"], rep: 50, stadium: "Pride Meadow" },
  { name: "Portsmouth Pompey", short: "POR", colors: ["#001489", "#ffffff"], rep: 49, stadium: "Fratton Docks" },
  { name: "Plymouth Pilgrims", short: "PLY", colors: ["#003c2d", "#ffffff"], rep: 47, stadium: "Home Harbour" },
  { name: "Oxford Scholars", short: "OXF", colors: ["#fff200", "#002147"], rep: 46, stadium: "Cherwell Field" },
  { name: "Luton Hatters", short: "LUT", colors: ["#f78f1e", "#002d62"], rep: 48, stadium: "Kenilworth Lane" },
  { name: "Ipswich Tractors", short: "IPS", colors: ["#0044a9", "#ffffff"], rep: 54, stadium: "Portman Meadow" },
  { name: "Millwall Lions", short: "MIL", colors: ["#001d5e", "#ffffff"], rep: 47, stadium: "The Den South" },
];

// Sim-only foreign leagues (selectable at save creation, §4)
export interface SimLeagueDef {
  id: string;
  name: string;
  country: string;
  nat: string; // dominant nationality pool
  clubs: ClubDef[];
}

// Each sim club now carries its own colours (real-flavoured, like the English
// clubs) so crests aren't all the same grey outside England. Row shape:
// [name, short, rep, primary, secondary].
function simClubs(
  rows: [string, string, number, string, string][],
  stadium: string
): ClubDef[] {
  return rows.map(([name, short, rep, primary, secondary]) => ({
    name,
    short,
    colors: [primary, secondary] as [string, string],
    rep,
    stadium: `${stadium}`,
  }));
}

export const SIM_LEAGUES: SimLeagueDef[] = [
  {
    id: "ESP1", name: "La Primera", country: "Spain", nat: "ESP",
    clubs: simClubs([
      ["Real Madrileno", "RMA", 91, "#ffffff", "#febe10"], ["Barcelona Blaugrana", "BAR", 89, "#a50044", "#004d98"], ["Atletico Capital", "ATC", 83, "#cb3524", "#ffffff"],
      ["Sevilla Rojo", "SEV", 74, "#d81920", "#ffffff"], ["Real Sociedad Norte", "RSN", 72, "#0067b1", "#ffffff"], ["Villareal Amarillo", "VIL", 71, "#ffe667", "#005187"],
      ["Athletic Bilbao Leones", "ATB", 70, "#ee2523", "#ffffff"], ["Real Betis Verde", "BET", 69, "#00954c", "#ffffff"], ["Valencia Naranja", "VAL", 68, "#ffffff", "#f18a00"],
      ["Celta Vigo Celeste", "CEL", 62, "#8ac3ee", "#ffffff"], ["Osasuna Rojillo", "OSA", 60, "#0a346f", "#d91a21"], ["Girona Blanquivermell", "GIR", 61, "#d0103a", "#ffffff"],
      ["Mallorca Bermellon", "MLL", 58, "#e20613", "#000000"], ["Getafe Azulon", "GET", 57, "#005999", "#ffffff"], ["Alaves Babazorro", "ALA", 55, "#0761af", "#ffffff"], ["Cadiz Amarillo", "CAD", 53, "#ffe500", "#004b91"],
    ], "Estadio Nacional"),
  },
  {
    id: "ITA1", name: "Il Campionato", country: "Italy", nat: "ITA",
    clubs: simClubs([
      ["Internazionale Nerazzurri", "INT", 87, "#010e80", "#000000"], ["Juventus Bianconeri", "JUV", 85, "#000000", "#ffffff"], ["Milano Rossoneri", "MIL", 84, "#fb090b", "#000000"],
      ["Napoli Azzurri", "NAP", 80, "#12a0d7", "#ffffff"], ["Roma Giallorossi", "ROM", 76, "#8e1f2f", "#f0bc42"], ["Lazio Biancocelesti", "LAZ", 73, "#87d8f7", "#ffffff"],
      ["Atalanta Orobici", "ATA", 74, "#1d1d1b", "#0075bf"], ["Fiorentina Viola", "FIO", 70, "#592c82", "#ffffff"], ["Bologna Rossoblu", "BOL", 66, "#a21c26", "#1a2f48"],
      ["Torino Granata", "TOR", 63, "#8a1c24", "#ffffff"], ["Udinese Friulani", "UDI", 60, "#000000", "#ffffff"], ["Genoa Grifone", "GEN", 58, "#c8102e", "#12284b"],
      ["Monza Brianzoli", "MON", 56, "#e2001a", "#ffffff"], ["Lecce Salentini", "LEC", 54, "#ffe500", "#c8102e"], ["Cagliari Isolani", "CAG", 55, "#a2123a", "#12284b"], ["Verona Scaligeri", "VER", 53, "#fff100", "#12284b"],
    ], "Stadio Comunale"),
  },
  {
    id: "GER1", name: "Die Erste Liga", country: "Germany", nat: "GER",
    clubs: simClubs([
      ["Bayern Munchen Stern", "BAY", 90, "#dc052d", "#ffffff"], ["Dortmund Borussen", "DOR", 82, "#fde100", "#000000"], ["Leipzig Bullen", "LEI", 78, "#dd0741", "#001f47"],
      ["Leverkusen Werkself", "LEV", 79, "#e32219", "#000000"], ["Frankfurt Adler", "FRA", 71, "#000000", "#e1000f"], ["Stuttgart Schwaben", "STU", 69, "#ffffff", "#e32219"],
      ["Wolfsburg Wolfe", "WOB", 66, "#65b32e", "#ffffff"], ["Gladbach Fohlen", "GLA", 65, "#000000", "#00a650"], ["Freiburg Breisgau", "FRE", 64, "#e1000f", "#000000"],
      ["Hoffenheim Kraichgau", "HOF", 62, "#1961b3", "#ffffff"], ["Union Eiserne", "UNI", 63, "#eb1923", "#ffe500"], ["Mainz Nullfunfer", "MAI", 58, "#c3141e", "#ffffff"],
      ["Koln Geissbocke", "KOL", 57, "#ffffff", "#e1000f"], ["Bremen Gruenweiss", "BRE", 59, "#1d9053", "#ffffff"], ["Augsburg Fuggerstadt", "AUG", 55, "#ba3733", "#46714d"], ["Bochum Unabsteigbar", "BOC", 52, "#005ca9", "#ffffff"],
    ], "Arena Deutschland"),
  },
  {
    id: "FRA1", name: "Le Championnat", country: "France", nat: "FRA",
    clubs: simClubs([
      ["Paris Princes", "PAR", 88, "#004170", "#e30613"], ["Marseille Phoceens", "MAR", 76, "#2faee0", "#ffffff"], ["Lyon Gones", "LYO", 72, "#ffffff", "#e30613"],
      ["Monaco Rouge et Blanc", "MON", 74, "#e51b22", "#ffffff"], ["Lille Dogues", "LIL", 69, "#e01e13", "#12284b"], ["Nice Aiglons", "NIC", 67, "#000000", "#e2001a"],
      ["Rennes Rouge et Noir", "REN", 66, "#e23328", "#000000"], ["Lens Sang et Or", "LEN", 65, "#ffe500", "#e2001a"], ["Strasbourg Alsace", "STR", 58, "#0075bf", "#ffffff"],
      ["Nantes Canaris", "NAN", 57, "#fdd835", "#008d36"], ["Montpellier Paillade", "MTP", 56, "#004a97", "#f57f29"], ["Toulouse Violets", "TOU", 55, "#5f259f", "#ffffff"],
      ["Reims Champenois", "REI", 54, "#e2001a", "#ffffff"], ["Brest Pirates", "BRS", 53, "#e2001a", "#ffffff"], ["Auxerre Ajaistes", "AUX", 51, "#ffffff", "#12284b"], ["Metz Grenats", "MET", 50, "#7a1228", "#ffffff"],
    ], "Stade Municipal"),
  },
];
