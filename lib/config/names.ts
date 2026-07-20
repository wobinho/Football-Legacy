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

  // ── v19: pools for every remaining country with a flag ───────────────────
  // Scouting is now open to the whole world (lib/config/scouting.ts), and a
  // scoutable country MUST have a pool here — `poolFor` falls back to the first
  // entry, so a country without one would generate English-named players.
  //
  // Grouped by linguistic family rather than continent, since that is what
  // actually governs naming: the Maghreb reads Arabic, not "African", and
  // Latin America reads Spanish/Portuguese, not "American".

  // ── British Isles ──
  {
    nat: "WAL",
    first: ["Gareth", "Aaron", "Daniel", "Ethan", "Harry", "Joe", "Kieffer", "Neco", "Rhys", "Dylan", "Owain", "Rhodri", "Ieuan", "Morgan", "Tomos"],
    last: ["Davies", "Evans", "Williams", "Jones", "Thomas", "Roberts", "Lewis", "Hughes", "Morgan", "Griffiths", "Owen", "Rees", "Price", "Bevan", "Vaughan", "Llewellyn", "Prosser", "Meredith", "Powell", "Gwynne"],
  },
  {
    nat: "NIR",
    first: ["Steven", "Jonny", "Conor", "Paddy", "Shea", "Niall", "Corry", "Dion", "Ciaron", "Trai", "Ross", "Daniel", "Jamal", "Isaac", "Callum"],
    last: ["Davis", "Evans", "McNair", "McGinn", "Charles", "Magennis", "Ferguson", "Toal", "Bradley", "Hume", "Saville", "Ballard", "Lewis", "Price", "Peacock-Farrell", "Flanagan", "Donnelly", "McCann", "Boyce", "Smyth"],
  },
  {
    nat: "IRL",
    first: ["Seamus", "Shane", "Matt", "Callum", "Josh", "Adam", "Chiedozie", "Jason", "Robbie", "Conor", "Jayson", "Dara", "Evan", "Finn", "Cillian"],
    last: ["Coleman", "Duffy", "Doherty", "Robinson", "Cullen", "Idah", "Ogbene", "Knight", "Brady", "Hourihane", "Molumby", "OShea", "Ferguson", "Egan", "McGrath", "Kelleher", "Byrne", "Murphy", "OConnor", "Kavanagh"],
  },

  // ── Nordics & Baltics ──
  {
    nat: "FIN",
    first: ["Teemu", "Joel", "Robin", "Glen", "Lukas", "Rasmus", "Fredrik", "Onni", "Leo", "Eetu", "Juho", "Mikael", "Niilo", "Aapo", "Ville"],
    last: ["Pukki", "Pohjanpalo", "Lod", "Kamara", "Hradecky", "Schuller", "Jensen", "Valakari", "Kallman", "Uronen", "Virtanen", "Korhonen", "Makinen", "Nieminen", "Heikkinen", "Laine", "Salonen", "Koskinen", "Lahti", "Rantanen"],
  },
  {
    nat: "ISL",
    first: ["Gylfi", "Alfred", "Jon", "Birkir", "Arnor", "Hakon", "Willum", "Andri", "Sverrir", "Mikael", "Orri", "Kolbeinn", "Runar", "Stefan", "Bjarni"],
    last: ["Sigurdsson", "Finnbogason", "Gudmundsson", "Bjarnason", "Traustason", "Magnusson", "Arnason", "Palsson", "Ingason", "Ellertsson", "Halldorsson", "Jonsson", "Thorsteinsson", "Gunnarsson", "Olafsson", "Einarsson", "Helgason", "Kristjansson", "Stefansson", "Bergsson"],
  },
  {
    nat: "EST",
    first: ["Ragnar", "Konstantin", "Karol", "Henri", "Rauno", "Vlasi", "Mattias", "Markus", "Erik", "Joonas", "Kristen", "Martin", "Sander", "Taijo", "Robi"],
    last: ["Klavan", "Vassiljev", "Mets", "Anier", "Sappinen", "Sinyavskiy", "Kait", "Poom", "Tamm", "Saar", "Kask", "Ots", "Kukk", "Ilves", "Raudsepp", "Lepik", "Parn", "Koppel", "Vaher", "Sepp"],
  },
  {
    nat: "LVA",
    first: ["Janis", "Roberts", "Vladislavs", "Gundars", "Kristers", "Raivis", "Andrejs", "Davis", "Marcis", "Eduards", "Antonijs", "Renars", "Toms", "Krisjanis", "Emils"],
    last: ["Ikaunieks", "Uldrikis", "Gutkovskis", "Zelenkovs", "Tobers", "Ciganiks", "Ciganiks", "Ikstens", "Oss", "Emsis", "Cernomordijs", "Varslavans", "Jaunzems", "Savalnieks", "Melgailis", "Berzins", "Ozols", "Kalnins", "Liepins", "Krumins"],
  },
  {
    nat: "LTU",
    first: ["Fedor", "Arvydas", "Vykintas", "Edvinas", "Rolandas", "Justas", "Gvidas", "Deividas", "Domantas", "Modestas", "Paulius", "Tomas", "Mantas", "Nerijus", "Linas"],
    last: ["Cernych", "Novikovas", "Slivka", "Girdvainis", "Baravykas", "Gineitis", "Simkus", "Matulevicius", "Kazlauskas", "Vaitkunas", "Petravicius", "Jankauskas", "Butkus", "Urbonas", "Stankevicius", "Zukauskas", "Balciunas", "Rimkus", "Navickas", "Sakalauskas"],
  },

  // ── Western Europe (remaining) ──
  {
    nat: "LUX",
    first: ["Gerson", "Danel", "Leandro", "Sebastien", "Vincent", "Mathias", "Olivier", "Maxime", "Florian", "Yvandro", "Aiman", "Dirk", "Marvin", "Christopher", "Enes"],
    last: ["Rodrigues", "Sinani", "Barreiro", "Thill", "Thill", "Olesen", "Jans", "Chanot", "Bohnert", "Borges", "Dardari", "Carlson", "Martins", "Moris", "Mahmutovic", "Weis", "Schmit", "Hoffmann", "Muller", "Klein"],
  },

  // ── Central Europe ──
  {
    nat: "SVK",
    first: ["Marek", "Milan", "Juraj", "Stanislav", "Lukas", "Ondrej", "David", "Tomas", "Matus", "Robert", "Vladimir", "Patrik", "Denis", "Martin", "Adam"],
    last: ["Hamsik", "Skriniar", "Kucka", "Lobotka", "Duda", "Duris", "Hancko", "Vavro", "Bero", "Mak", "Weiss", "Rusnak", "Satka", "Skriniar", "Gregus", "Novak", "Kovac", "Horvath", "Balaz", "Varga"],
  },
  {
    nat: "HUN",
    first: ["Dominik", "Roland", "Willi", "Adam", "Attila", "Andras", "Peter", "Barnabas", "Milos", "Zsolt", "Daniel", "Balazs", "Gergo", "Marton", "Kevin"],
    last: ["Szoboszlai", "Sallai", "Orban", "Nagy", "Fiola", "Schafer", "Gulacsi", "Varga", "Kerkez", "Nego", "Bolla", "Styles", "Kata", "Szalai", "Botka", "Kovacs", "Toth", "Horvath", "Molnar", "Farkas"],
  },
  {
    nat: "SVN",
    first: ["Jan", "Benjamin", "Josip", "Adam", "Sandi", "Timi", "Petar", "Miha", "Erik", "Vanja", "Jaka", "Zan", "David", "Nejc", "Domen"],
    last: ["Oblak", "Sesko", "Ilicic", "Cerin", "Lovric", "Elsnik", "Stojanovic", "Blazic", "Janza", "Drkusic", "Bijol", "Karnicnik", "Verbic", "Zajc", "Gorenc", "Novak", "Kovacic", "Zupan", "Hrvatin", "Mlakar"],
  },

  // ── Eastern Europe ──
  {
    nat: "BUL",
    first: ["Kiril", "Georgi", "Ilia", "Todor", "Valentin", "Petko", "Dimitar", "Preslav", "Martin", "Filip", "Andrian", "Ivan", "Nikolay", "Stefan", "Borislav"],
    last: ["Despodov", "Milanov", "Gruev", "Nedelev", "Antov", "Hristov", "Chochev", "Borukov", "Minchev", "Krastev", "Georgiev", "Dimitrov", "Ivanov", "Petrov", "Stoyanov", "Nikolov", "Todorov", "Iliev", "Vasilev", "Angelov"],
  },
  {
    nat: "BLR",
    first: ["Maksim", "Vitaly", "Igor", "Nikolai", "Yuri", "Pavel", "Aleksandr", "Denis", "Valery", "Vladislav", "Ivan", "Roman", "Anton", "Evgeni", "Kirill"],
    last: ["Skavysh", "Lisakovich", "Stasevich", "Signevich", "Kovalev", "Sadovsky", "Martynovich", "Laptev", "Gromyko", "Klimovich", "Bakhar", "Yablonsky", "Shevchenko", "Volkov", "Ivanov", "Kozlov", "Novik", "Melnik", "Zhuk", "Savitsky"],
  },
  {
    nat: "MDA",
    first: ["Ion", "Vadim", "Artur", "Serghei", "Vitalie", "Oleg", "Maxim", "Veaceslav", "Radu", "Catalin", "Danu", "Mihail", "Andrei", "Nichita", "Alexandru"],
    last: ["Nicolaescu", "Rata", "Ionita", "Platica", "Damascan", "Reabciuk", "Cojocari", "Posmac", "Bolohan", "Carauleanu", "Motpan", "Baboglo", "Munteanu", "Rusu", "Ciobanu", "Popescu", "Lupu", "Cebotari", "Gatcan", "Dumbravanu"],
  },

  // ── Balkans ──
  {
    nat: "BIH",
    first: ["Edin", "Miralem", "Sead", "Rade", "Amer", "Ermedin", "Haris", "Denis", "Armin", "Sanjin", "Nihad", "Benjamin", "Dennis", "Adnan", "Emir"],
    last: ["Dzeko", "Pjanic", "Kolasinac", "Krunic", "Gojak", "Demirovic", "Hajradinovic", "Huseinbasic", "Prevljak", "Tahirovic", "Mujakic", "Cipetic", "Bicakcic", "Hadziahmetovic", "Cengic", "Begovic", "Salihovic", "Ibisevic", "Todorovic", "Zukanovic"],
  },
  {
    nat: "MKD",
    first: ["Goran", "Eljif", "Enis", "Ezgjan", "Stefan", "Darko", "Bojan", "Aleksandar", "Visar", "Milan", "Jani", "Tihomir", "Marjan", "Kire", "Boban"],
    last: ["Pandev", "Elmas", "Bardhi", "Alioski", "Ristovski", "Velkovski", "Miovski", "Trajkovski", "Musliu", "Ristovski", "Atanasov", "Kostadinov", "Radeski", "Nikolov", "Georgievski", "Stojanovski", "Petrovski", "Ilievski", "Dimitrov", "Mitrev"],
  },
  {
    nat: "ALB",
    first: ["Armando", "Sokol", "Elseid", "Berat", "Keidi", "Myrto", "Kristjan", "Nedim", "Qazim", "Ardian", "Marash", "Klaus", "Endri", "Taulant", "Amir"],
    last: ["Broja", "Cikalleshi", "Hysaj", "Djimsiti", "Bare", "Uzuni", "Asllani", "Bajrami", "Laci", "Ismajli", "Kumbulla", "Gjasula", "Berisha", "Hoxha", "Shehi", "Mema", "Balaj", "Cani", "Dermaku", "Veseli"],
  },
  {
    nat: "MNE",
    first: ["Stevan", "Stefan", "Nikola", "Marko", "Milutin", "Vasilije", "Andrija", "Sasa", "Risto", "Driton", "Milos", "Igor", "Adam", "Petar", "Luka"],
    last: ["Jovetic", "Savic", "Vukcevic", "Simic", "Osmajic", "Adzic", "Vukotic", "Ivanovic", "Radunovic", "Haxhi", "Raspopovic", "Vujacic", "Marusic", "Perisic", "Scepanovic", "Boskovic", "Djurovic", "Kaludjerovic", "Tomasevic", "Krstovic"],
  },
  {
    nat: "KVX",
    first: ["Vedat", "Milot", "Amir", "Bersant", "Elbasan", "Zymer", "Florent", "Ibrahim", "Lirim", "Edon", "Arber", "Besar", "Mergim", "Valon", "Fidan"],
    last: ["Muriqi", "Rashica", "Rrahmani", "Celina", "Rashani", "Bytyqi", "Muslija", "Dresevic", "Kastrati", "Zhegrova", "Zeneli", "Halimi", "Vojvoda", "Berisha", "Aliti", "Hadergjonaj", "Kryeziu", "Loshaj", "Nuhiu", "Selmani"],
  },
  {
    nat: "CYP",
    first: ["Pieros", "Ioannis", "Kostakis", "Andreas", "Grigoris", "Charalampos", "Nikolas", "Fotis", "Marios", "Konstantinos", "Loizos", "Stelios", "Giorgos", "Minas", "Dimitris"],
    last: ["Sotiriou", "Kousoulos", "Artymatas", "Karo", "Kastanos", "Kyriakou", "Panagiotou", "Papoulis", "Elia", "Laifis", "Loizou", "Christofi", "Michael", "Andreou", "Georgiou", "Charalambous", "Nicolaou", "Constantinou", "Ioannou", "Savva"],
  },

  // ── Caucasus ──
  {
    nat: "GEO",
    first: ["Khvicha", "Giorgi", "Budu", "Zuriko", "Otar", "Saba", "Luka", "Guram", "Levan", "Nika", "Vako", "Anzor", "Lasha", "Irakli", "Davit"],
    last: ["Kvaratskhelia", "Chakvetadze", "Zivzivadze", "Davitashvili", "Kiteishvili", "Lobjanidze", "Lochoshvili", "Kashia", "Shengelia", "Kvekveskiri", "Gvilia", "Mamardashvili", "Tsitaishvili", "Beridze", "Azarovi", "Gogoladze", "Kobakhidze", "Mikautadze", "Chanturia", "Altunashvili"],
  },
  {
    nat: "ARM",
    first: ["Henrikh", "Eduard", "Tigran", "Norberto", "Kamo", "Vahan", "Varazdat", "Grigor", "Hovhannes", "Sargis", "Artak", "Gevorg", "Aleksandr", "Narek", "Styopa"],
    last: ["Mkhitaryan", "Spertsyan", "Barseghyan", "Briasco", "Hovhannisyan", "Bichakhchyan", "Haroyan", "Meliksetyan", "Hambardzumyan", "Adamyan", "Dashyan", "Ghazaryan", "Grigoryan", "Petrosyan", "Sargsyan", "Avetisyan", "Manucharyan", "Voskanyan", "Yedigaryan", "Mkoyan"],
  },
  {
    nat: "AZE",
    first: ["Ramil", "Emin", "Mahir", "Renat", "Anton", "Bahlul", "Elvin", "Filip", "Rahil", "Tamkin", "Ismayil", "Rufat", "Eddy", "Hojjat", "Abbas"],
    last: ["Sheydayev", "Makhmudov", "Emreli", "Dadashov", "Krivotsyuk", "Mustafazada", "Badalov", "Ozobic", "Mammadov", "Khalilzada", "Ibrahimli", "Aliyev", "Israfilov", "Haghverdi", "Huseynov", "Guliyev", "Hasanov", "Rzayev", "Abbasov", "Jafarov"],
  },

  // ── North Africa / Maghreb (Arabic & Amazigh naming) ──
  {
    nat: "MAR",
    first: ["Achraf", "Hakim", "Youssef", "Sofyan", "Azzedine", "Noussair", "Romain", "Yahya", "Bilal", "Abde", "Amine", "Selim", "Ilias", "Nayef", "Anass"],
    last: ["Hakimi", "Ziyech", "EnNesyri", "Amrabat", "Ounahi", "Mazraoui", "Saiss", "Attiat", "ElKhannouss", "Ezzalzouli", "Harit", "Amallah", "Chair", "Aguerd", "Zalzouli", "Benoun", "Dari", "Bounou", "Tagnaouti", "Boufal"],
  },
  {
    nat: "ALG",
    first: ["Riyad", "Islam", "Said", "Ramy", "Youcef", "Adem", "Aissa", "Ramiz", "Houssem", "Nabil", "Amir", "Farid", "Sofiane", "Mehdi", "Baghdad"],
    last: ["Mahrez", "Slimani", "Benrahma", "Bensebaini", "Atal", "Zerrouki", "Mandi", "Zerkane", "Aouar", "Bentaleb", "Boudaoui", "Belaili", "Feghouli", "Tahrat", "Bounedjah", "Amoura", "Guedioura", "Benlamri", "Chaibi", "Ounas"],
  },
  {
    nat: "TUN",
    first: ["Wahbi", "Youssef", "Aissa", "Hannibal", "Ellyes", "Montassar", "Mohamed", "Anis", "Seifeddine", "Ali", "Elias", "Naim", "Ferjani", "Dylan", "Yassine"],
    last: ["Khazri", "Msakni", "Laidouni", "Mejbri", "Skhiri", "Talbi", "Drager", "Slimane", "Jaziri", "Abdi", "Achouri", "Sliti", "Sassi", "Bronn", "Meriah", "Ben Romdhane", "Maaloul", "Hassen", "Dahmen", "Ghandri"],
  },
  {
    nat: "EGY",
    first: ["Mohamed", "Omar", "Mostafa", "Trezeguet", "Ahmed", "Emam", "Mahmoud", "Ramadan", "Akram", "Karim", "Tarek", "Hossam", "Amr", "Ibrahim", "Zizo"],
    last: ["Salah", "Marmoush", "Mohamed", "Hegazi", "Elneny", "Ashour", "Hassan", "Sobhi", "Fattouh", "Tawfik", "Hamdi", "Ghaly", "Warda", "Wahba", "Fathi", "ElSaid", "Abdelmonem", "Shenawy", "Sobhy", "ElSolia"],
  },
  {
    nat: "LBY",
    first: ["Muaid", "Hamdou", "Anis", "Sand", "Ahmad", "Faisal", "Motasem", "Ali", "Omar", "Sanad", "Rabie", "Salem", "Mohamed", "Abdulla", "Nader"],
    last: ["Ellafi", "Elhouni", "Saltou", "Alwarfali", "Benali", "Badi", "Alabidi", "Salama", "Alkhoja", "Warfali", "Ashour", "Masli", "Zubya", "Ghanudi", "Trbelsi", "Elmarimi", "Alshibani", "Bengrira", "Muftah", "Hamroush"],
  },
  {
    nat: "MTN",
    first: ["Aboubakar", "Ibrahima", "Pape", "Bakary", "Hemeya", "Sidi", "El Hacen", "Moctar", "Yali", "Souleymane", "Khalil", "Mohamed", "Diallo", "Aly", "Beibou"],
    last: ["Kamara", "Diallo", "Traore", "NDiaye", "Tanjy", "Bakary", "ElId", "Sidibe", "Dellahi", "Coulibaly", "Bagayoko", "Soumare", "Camara", "Sylla", "Fall", "Ba", "Sow", "Cisse", "Toure", "Sarr"],
  },

  // ── West Africa (Francophone) ──
  {
    nat: "SEN",
    first: ["Sadio", "Kalidou", "Idrissa", "Ismaila", "Boulaye", "Nampalys", "Pape", "Krepin", "Abdou", "Cheikhou", "Youssouf", "Habib", "Iliman", "Nicolas", "Formose"],
    last: ["Mane", "Koulibaly", "Gueye", "Sarr", "Dia", "Mendy", "Diallo", "Diatta", "Ciss", "Kouyate", "Sabaly", "Jakobs", "Ndiaye", "Jackson", "Mendy", "Diedhiou", "Seck", "Diouf", "Faye", "Ndoye"],
  },
  {
    nat: "CIV",
    first: ["Sebastien", "Franck", "Nicolas", "Ibrahim", "Serge", "Jean-Philippe", "Wilfried", "Seko", "Ousmane", "Odilon", "Simon", "Christian", "Max", "Ghislain", "Evan"],
    last: ["Haller", "Kessie", "Pepe", "Sangare", "Aurier", "Gbamin", "Singo", "Fofana", "Diomande", "Kossounou", "Adingra", "Kouame", "Gradel", "Konan", "Bailly", "Boly", "Seri", "Zaha", "Traore", "Doumbia"],
  },
  {
    nat: "GUI",
    first: ["Naby", "Serhou", "Ilaix", "Mohamed", "Amadou", "Sory", "Issiaga", "Aguibou", "Morlaye", "Francois", "Seydouba", "Mamadou", "Ibrahima", "Alseny", "Sekou"],
    last: ["Keita", "Guirassy", "Moriba", "Bayo", "Diawara", "Kaba", "Sylla", "Camara", "Sangare", "Kamano", "Soumah", "Conte", "Diallo", "Toure", "Barry", "Cisse", "Bangoura", "Traore", "Balde", "Yattara"],
  },
  {
    nat: "MLI",
    first: ["Amadou", "Yves", "Moussa", "Hamari", "Sekou", "Diadie", "Nene", "Boubacar", "Kamory", "Cheick", "Mohamed", "Aliou", "Lassine", "Massadio", "Adama"],
    last: ["Haidara", "Bissouma", "Djenepo", "Traore", "Koita", "Samassekou", "Dorgeles", "Kouyate", "Doumbia", "Doucoure", "Camara", "Dieng", "Sinayoko", "Haidara", "Noss", "Coulibaly", "Diarra", "Konate", "Fofana", "Keita"],
  },
  {
    nat: "BFA",
    first: ["Bertrand", "Issa", "Edmond", "Dango", "Blati", "Cyrille", "Adama", "Zakaria", "Ismahila", "Gustavo", "Mohamed", "Herve", "Steeve", "Abdoul", "Lassina"],
    last: ["Traore", "Kabore", "Tapsoba", "Ouattara", "Toure", "Bayala", "Guira", "Sanogo", "Ouedraogo", "Sangare", "Konate", "Koffi", "Yameogo", "Tapsoba", "Nikiema", "Zongo", "Compaore", "Sawadogo", "Belem", "Simpore"],
  },
  {
    nat: "BEN",
    first: ["Steve", "Jodel", "Cebio", "Junior", "Sessi", "Olivier", "Yohan", "David", "Marcelin", "Desire", "Tosin", "Andreas", "Rodrigue", "Saturnin", "Imourane"],
    last: ["Mounie", "Dossou", "Soumaoro", "Olaitan", "DAlmeida", "Verdon", "Roche", "Kiki", "Koukpo", "Azankpo", "Aiyegun", "Hountondji", "Kossi", "Allagbe", "Adenon", "Sessegnon", "Tijani", "Ahoueya", "Poteau", "Djibril"],
  },
  {
    nat: "TOG",
    first: ["Emmanuel", "Kevin", "Djene", "Ihlas", "Thomas", "Peniel", "Yendoutie", "Matthieu", "Placide", "Roger", "Samuel", "Komlan", "Kodjo", "Sadat", "Elie"],
    last: ["Adebayor", "Denkey", "Dakonam", "Bebou", "Dossevi", "Mlapa", "Nane", "Dossou", "Djiwa", "Assale", "Asamoah", "Agbegniadan", "Laba", "Ouro-Sama", "Kossi", "Amewou", "Gakpe", "Segbefia", "Tchakei", "Aholou"],
  },
  {
    nat: "NIG",
    first: ["Victorien", "Youssouf", "Olivier", "Ibrahim", "Amadou", "Boubacar", "Daniel", "Moussa", "Zakari", "Souleymane", "Abdoul", "Ismael", "Koffi", "Salim", "Mahamane"],
    last: ["Adebayor", "Oumarou", "Bonkano", "Moussa", "Sabo", "Talatou", "Hassane", "Maazou", "Alhassane", "Garba", "Issoufou", "Amadou", "Djibo", "Boubacar", "Idrissa", "Seyni", "Yacouba", "Chaibou", "Abdourahmane", "Harouna"],
  },
  {
    nat: "SLE",
    first: ["Kei", "Musa", "Mohamed", "Alhaji", "Umaru", "Steven", "Amadou", "Issa", "Sheriff", "Yeami", "Augustus", "John", "Alie", "Osman", "Ibrahim"],
    last: ["Kamara", "Noah", "Buya", "Kargbo", "Bangura", "Caulker", "Bah", "Kanu", "Sesay", "Dumbuya", "Conteh", "Turay", "Mansaray", "Koroma", "Sankoh", "Fofanah", "Jalloh", "Sowe", "Kabia", "Tholley"],
  },
  {
    nat: "GAM",
    first: ["Musa", "Ablie", "Yusupha", "Ebrima", "Assan", "Modou", "Saidy", "Omar", "Muhammed", "Alassana", "Lamin", "Sulayman", "Noah", "Bubacarr", "Steve"],
    last: ["Barrow", "Jallow", "Njie", "Colley", "Ceesay", "Bojang", "Janko", "Jobe", "Sanneh", "Marreh", "Camara", "Bah", "Sonko", "Trawally", "Darboe", "Gaye", "Touray", "Jarju", "Manneh", "Sillah"],
  },
  {
    nat: "GNB",
    first: ["Mama", "Franculino", "Jorginho", "Mamadu", "Zinho", "Alfa", "Opa", "Pele", "Joseph", "Nanu", "Sori", "Toni", "Frederico", "Bruno", "Moreto"],
    last: ["Balde", "Dju", "Rubio", "Candé", "Vega", "Semedo", "Nguema", "Mendes", "Djalo", "Baldé", "Mane", "Silva", "Varela", "Fernandes", "Cassama", "Embalo", "Ianique", "Correia", "Camara", "Turé"],
  },
  {
    nat: "CPV",
    first: ["Ryan", "Garry", "Jamiro", "Bebe", "Kenny", "Logan", "Gilson", "Deroy", "Dylan", "Steven", "Nuno", "Sidnei", "Bruno", "Marco", "Vozinha"],
    last: ["Mendes", "Rodrigues", "Monteiro", "Tavares", "Rocha", "Costa", "Benchimol", "Duarte", "Semedo", "Fortes", "Borges", "Lopes", "Varela", "Andrade", "Furtado", "Cabral", "Delgado", "Moreira", "Livramento", "Barbosa"],
  },

  // ── West Africa (Anglophone) ──
  {
    nat: "GHA",
    first: ["Thomas", "Mohammed", "Jordan", "Andre", "Inaki", "Antoine", "Kamaldeen", "Alexander", "Daniel", "Osman", "Elisha", "Baba", "Joseph", "Gideon", "Ernest"],
    last: ["Partey", "Kudus", "Ayew", "Ayew", "Williams", "Semenyo", "Sulemana", "Djiku", "Amartey", "Bukari", "Owusu", "Rahman", "Paintsil", "Mensah", "Nuamah", "Odoi", "Lamptey", "Salisu", "Aidoo", "Asante"],
  },

  // ── Central Africa ──
  {
    nat: "CMR",
    first: ["Vincent", "Andre", "Karl", "Bryan", "Georges", "Christian", "Olivier", "Martin", "Jean-Charles", "Nouhou", "Collins", "Enzo", "Frank", "Michael", "Christopher"],
    last: ["Aboubakar", "Onana", "Toko Ekambi", "Mbeumo", "Mbeumo", "Bassogog", "Ntcham", "Hongla", "Castelletto", "Tolo", "Fai", "Ebosse", "Zambo", "Ngamaleu", "Wooh", "Anguissa", "Choupo-Moting", "Oyongo", "Nkoulou", "Moukandjo"],
  },
  {
    nat: "GAB",
    first: ["Pierre-Emerick", "Denis", "Mario", "Aaron", "Guelor", "Andre", "Bruno", "Anthony", "Johann", "Yannis", "Lloyd", "Shavy", "Axel", "Didier", "Jeremy"],
    last: ["Aubameyang", "Bouanga", "Lemina", "Appindangoye", "Kanga", "Poko", "Ecuele", "Oyono", "Obiang", "NGoua", "Palun", "Babicka", "Meye", "Ndong", "Boupendza", "Madinda", "Allevinah", "Ndoumbou", "Mouloungui", "Ondo"],
  },
  {
    nat: "COD",
    first: ["Yoane", "Cedric", "Chancel", "Gael", "Silas", "Meschack", "Theo", "Arthur", "Samuel", "Fiston", "Dieumerci", "Glody", "Marcel", "Ben", "Aaron"],
    last: ["Wissa", "Bakambu", "Mbemba", "Kakuta", "Katompa", "Elia", "Bongonda", "Masuaku", "Moutoussamy", "Mayele", "Mbokani", "Ngonda", "Tisserand", "Malango", "Wan-Bissaka", "Kayembe", "Mpasi", "Luyindama", "Ilunga", "Kalulu"],
  },
  {
    nat: "CGO",
    first: ["Prince", "Thievy", "Yhoan", "Silvere", "Merveil", "Bradley", "Beranger", "Dylan", "Junior", "Christoffer", "Gaius", "Bervic", "Warren", "Kevin", "Duckens"],
    last: ["Oniangue", "Bifouma", "Andzouana", "Ganvoula", "Ndockyt", "Mbemba", "Itoua", "Bahamboula", "Makiesse", "Mbondi", "Makouta", "Moukoko", "Tsoumou", "Koulinga", "Nazon", "Bissiki", "Ondongo", "Bakouma", "Massouema", "Elion"],
  },
  {
    nat: "EQG",
    first: ["Emilio", "Jose", "Pablo", "Iban", "Basilio", "Federico", "Saul", "Josete", "Luis", "Diosdado", "Carlos", "Esteban", "Ivan", "Ramon", "Salomon"],
    last: ["Nsue", "Machin", "Ganet", "Salvador", "Ndong", "Bikoro", "Coto", "Miranda", "Nlavo", "Mba", "Akapo", "Obiang", "Buyla", "Ela", "Owono", "Bodipo", "Engonga", "Balboa", "Sipo", "Eneme"],
  },
  {
    nat: "CTA",
    first: ["Geoffrey", "Louis", "Yakou", "Eddy", "Hilaire", "Jordan", "Marlon", "Kevin", "Bevic", "Jerome", "Cedric", "Rolf", "Gaius", "Junior", "Wilfried"],
    last: ["Kondogbia", "Mafouta", "Meite", "Pascal", "Momi", "Ikaunieks", "Guelord", "Yakite", "Moukanda", "Ngaissona", "Doumbe", "Feindouno", "Namnganda", "Zoua", "Kossi", "Beto", "Nzale", "Yongo", "Manzoki", "Sylla"],
  },

  // ── East Africa ──
  {
    nat: "KEN",
    first: ["Michael", "Victor", "Masud", "Erick", "Richard", "Johanna", "Ayub", "Kenneth", "Duke", "Eric", "Brian", "Timothy", "Cliff", "Abud", "Daniel"],
    last: ["Olunga", "Wanyama", "Juma", "Ouma", "Odada", "Omollo", "Timbe", "Muguna", "Abuya", "Johana", "Mandela", "Otieno", "Nyakundi", "Omara", "Sakwa", "Wanyonyi", "Kimani", "Mwangi", "Kipchumba", "Ochieng"],
  },
  {
    nat: "TAN",
    first: ["Mbwana", "Simon", "Feisal", "Novatus", "Himid", "Aishi", "Mudathir", "Salum", "Ibrahim", "Farid", "Yassin", "Kelvin", "Shomari", "Iddi", "Abdulrazak"],
    last: ["Samatta", "Msuva", "Salum", "Miserere", "Mkami", "Manula", "Yusuph", "Abdallah", "Ame", "Mussa", "Mgunda", "Nassoro", "Kapombe", "Nadir", "Hamisi", "Juma", "Mwakalebela", "Kessy", "Ulimwengu", "Mnata"],
  },
  {
    nat: "UGA",
    first: ["Farouk", "Emmanuel", "Denis", "Khalid", "Allan", "Bobosi", "Milton", "Halid", "Fahad", "Steven", "Moses", "Ibrahim", "Charles", "Joseph", "Isaac"],
    last: ["Miya", "Okwi", "Onyango", "Aucho", "Okello", "Byaruhanga", "Karisa", "Lwaliwa", "Bayo", "Mukiibi", "Waiswa", "Sadam", "Lukwago", "Ochaya", "Muleme", "Kaddu", "Ssekiganda", "Mutyaba", "Wadada", "Kizito"],
  },
  {
    nat: "ETH",
    first: ["Getaneh", "Shimelis", "Abubeker", "Ramkel", "Mesud", "Amanuel", "Yared", "Dawa", "Surafel", "Fasil", "Bezabeh", "Gatoch", "Abel", "Tafese", "Bereket"],
    last: ["Kebede", "Bekele", "Nasir", "Mol", "Mohammed", "Gebremichael", "Baye", "Hotessa", "Dagnachew", "Gebremichael", "Meshesha", "Panom", "Yalew", "Solomon", "Desalegn", "Girma", "Tesfaye", "Hailu", "Alemu", "Wolde"],
  },
  {
    nat: "SOM",
    first: ["Abdisalam", "Omar", "Mohamed", "Yusuf", "Said", "Ahmed", "Abdullahi", "Hassan", "Liban", "Farhan", "Ismail", "Abdirahman", "Khalid", "Ayub", "Guled"],
    last: ["Ibrahim", "Hassan", "Ali", "Abdi", "Warsame", "Farah", "Nur", "Osman", "Adan", "Jama", "Yusuf", "Mohamud", "Elmi", "Aden", "Diriye", "Barre", "Hersi", "Samatar", "Gedi", "Dahir"],
  },
  {
    nat: "BDI",
    first: ["Saido", "Cedric", "Gael", "Fiston", "Youssouf", "Blaise", "Shassiri", "Hussein", "Karim", "Elvis", "Bonfils", "Frederic", "Jonathan", "Ally", "Pierrot"],
    last: ["Berahino", "Amissi", "Bigirimana", "Abedi", "Ndikumana", "Itangishaka", "Nahimana", "Shabani", "Nizigiyimana", "Kamana", "Nduwarugira", "Nsabiyumva", "Bukuru", "Hakizimana", "Ndayishimiye", "Manirakiza", "Niyonzima", "Irankunda", "Havyarimana", "Bizimana"],
  },
  {
    nat: "COM",
    first: ["Youssouf", "Faiz", "Ben", "Chaker", "Mohamed", "El Fardou", "Rafidine", "Ibroihim", "Alexis", "Yacine", "Abdallah", "Nakibou", "Ahmed", "Fouad", "Kassim"],
    last: ["MChangama", "Selemani", "Nabouhane", "Alhadhur", "Mben", "Abdou", "Bengaly", "Youssouf", "Souleymane", "Bourhane", "Ahamada", "Aboubakari", "Mogni", "Bachirou", "Djoudja", "Hamada", "Msabaha", "Moussa", "Attoumani", "Said"],
  },
  {
    nat: "MAD",
    first: ["Faneva", "Njiva", "Carolus", "Lalaina", "Rayan", "Marco", "Anicet", "Romain", "Jerome", "Thomas", "Melvin", "Warren", "Ibrahim", "Loic", "Tokinantenaina"],
    last: ["Andriatsima", "Randrianasolo", "Andriamatsinoro", "Nomenjanahary", "Raveloson", "Ilmaitsiory", "Abel", "Metanire", "Mombris", "Fontaine", "Adrien", "Caleb", "Amada", "Lapoussin", "Rakotoharimalala", "Rakotondrabe", "Randriamampionona", "Ravonison", "Rasoloarison", "Andrianarimanana"],
  },
  {
    nat: "MOZ",
    first: ["Reinildo", "Geny", "Stanley", "Witiness", "Clesio", "Domingues", "Edmilson", "Bruno", "Telinho", "Zainadine", "Elias", "Isac", "Luis", "Diogo", "Alfonso"],
    last: ["Mandava", "Catanha", "Ratcliffe", "Quembo", "Bau", "Mexer", "Dove", "Langa", "Junior", "Nhabinde", "Pelembe", "Amade", "Miquissone", "Buce", "Mabo", "Chirindza", "Macuacua", "Sitoe", "Cuinica", "Tomas"],
  },
  {
    nat: "ANG",
    first: ["Gelson", "Fredy", "Zito", "Mabululu", "Milson", "Show", "Jonathan", "Manuel", "Depu", "Chico", "Ary", "Bruno", "Clinton", "Bastos", "Neblu"],
    last: ["Dala", "Ribeiro", "Luvumbu", "Cabungula", "Bastos", "Banza", "Buatu", "Cabral", "Antonio", "Fernandes", "Papel", "Mendonca", "Wilson", "Zini", "Muachiquiquia", "Sanguena", "Zola", "Bebucho", "Massunguna", "Kialonda"],
  },
  {
    nat: "ZAM",
    first: ["Patson", "Fashion", "Enock", "Lubambo", "Kings", "Clatous", "Frankie", "Emmanuel", "Edward", "Lameck", "Rally", "Roderick", "Kennedy", "Golden", "Benson"],
    last: ["Daka", "Sakala", "Mwepu", "Musonda", "Kangwa", "Chama", "Musonda", "Banda", "Chilufya", "Banda", "Bwalya", "Kola", "Musonda", "Mudenda", "Sakala", "Phiri", "Mulenga", "Tembo", "Zulu", "Simutowe"],
  },
  {
    nat: "ZIM",
    first: ["Marshall", "Knowledge", "Marvelous", "Khama", "Tino", "Tendayi", "Jordan", "Terrence", "Divine", "Blessing", "Prince", "Teenage", "Alec", "Brendan", "Washington"],
    last: ["Munetsi", "Musona", "Nakamba", "Billiat", "Kadewere", "Darikwa", "Zemura", "Dzvukamanja", "Lacoste", "Sanyanga", "Dube", "Hadebe", "Mudimu", "Galloway", "Arubi", "Chirewa", "Makumbe", "Karuru", "Rusike", "Mhango"],
  },
  {
    nat: "RSA",
    first: ["Percy", "Themba", "Lyle", "Ronwen", "Teboho", "Thapelo", "Evidence", "Siyanda", "Sphephelo", "Bongokuhle", "Grant", "Mothobi", "Aubrey", "Khuliso", "Zakhele"],
    last: ["Tau", "Zwane", "Foster", "Williams", "Mokoena", "Morena", "Makgopa", "Xulu", "Sithole", "Hlongwane", "Kekana", "Mvala", "Modiba", "Mudau", "Lakay", "Mothiba", "Ngcobo", "Sirino", "Dlamini", "Mbatha"],
  },
  {
    nat: "CHA",
    first: ["Ezechiel", "Casimir", "Marius", "Karl", "Yannick", "Brahim", "Kevin", "Mahamat", "Abdelkerim", "Sirven", "Nathan", "Djerabe", "Ali", "Hillaire", "Yoan"],
    last: ["Ndouassel", "Ninga", "Mouandilmadji", "Kere", "Djimadoum", "Bagaya", "Doumbe", "Hassan", "Adoum", "Kedigui", "Betolngar", "Ngueadoum", "Youssouf", "Nadjita", "Ngarndjibaye", "Beral", "Mbainguebem", "Djalta", "Rimtebaye", "Allahissem"],
  },

  // ── North America ──
  {
    nat: "CAN",
    first: ["Alphonso", "Jonathan", "Stephen", "Cyle", "Tajon", "Ismael", "Atiba", "Richie", "Alistair", "Jacob", "Liam", "Kamal", "Junior", "Milan", "Derek"],
    last: ["Davies", "David", "Eustaquio", "Larin", "Buchanan", "Kone", "Hutchinson", "Laryea", "Johnston", "Shaffelburg", "Millar", "Miller", "Hoilett", "Borjan", "Cornelius", "Bombito", "Adekugbe", "Vitoria", "Piette", "Osorio"],
  },

  // ── Central America & Caribbean ──
  {
    nat: "CRC",
    first: ["Keylor", "Joel", "Celso", "Francisco", "Brandon", "Manfred", "Orlando", "Kendall", "Anthony", "Alvaro", "Juan Pablo", "Josimar", "Carlos", "Jefferson", "Alonso"],
    last: ["Navas", "Campbell", "Borges", "Calvo", "Aguilera", "Ugalde", "Galo", "Waston", "Contreras", "Zamora", "Vargas", "Alpizar", "Martinez", "Brenes", "Salvatierra", "Sequeira", "Fuller", "Bennette", "Mora", "Chacon"],
  },
  {
    nat: "HON",
    first: ["Alberth", "Anthony", "Romell", "Denil", "Kervin", "Rigoberto", "Edwin", "Deybi", "Jorge", "Luis", "Andy", "Jonathan", "Alexander", "Bryan", "Carlos"],
    last: ["Elis", "Lozano", "Quioto", "Miralda", "Arriaga", "Rivera", "Rodriguez", "Flores", "Alvarez", "Palma", "Najar", "Rubio", "Lopez", "Acosta", "Pineda", "Garcia", "Martinez", "Discua", "Beckeles", "Crisanto"],
  },
  {
    nat: "PAN",
    first: ["Adalberto", "Anibal", "Jose", "Michael", "Cecilio", "Ismael", "Cristian", "Eric", "Edgardo", "Fidel", "Andres", "Freddy", "Abdiel", "Omar", "Alfredo"],
    last: ["Carrasquilla", "Godoy", "Fajardo", "Murillo", "Waterman", "Diaz", "Martinez", "Davis", "Farina", "Escobar", "Andrade", "Gondola", "Ayala", "Browne", "Stephens", "Cordoba", "Rodriguez", "Blackman", "Quintero", "Gonzalez"],
  },
  {
    nat: "GUA",
    first: ["Carlos", "Rubio", "Oscar", "Nicholas", "Antonio", "Jose", "Jesus", "Stheven", "Aaron", "Rodrigo", "Darwin", "Jorge", "Marco", "Luis", "Kevin"],
    last: ["Ruiz", "Rubin", "Santis", "Hagen", "Lopez", "Morales", "Lopez", "Garcia", "Herrera", "Saravia", "Lom", "Aparicio", "Dominguez", "Martinez", "Ruiz", "Escobar", "Gutierrez", "Mendez", "Cardona", "Contreras"],
  },
  {
    nat: "SLV",
    first: ["Alex", "Nelson", "Enrico", "Darwin", "Jairo", "Christian", "Bryan", "Ronald", "Narciso", "Mario", "Eriq", "Amando", "Marcelo", "Joshua", "Diego"],
    last: ["Roldan", "Bonilla", "Duenas", "Ceren", "Henriquez", "Gil", "Landaverde", "Rodriguez", "Orellana", "Gonzalez", "Zavaleta", "Moreno", "Diaz", "Perez", "Coreas", "Portillo", "Larin", "Menjivar", "Alvarado", "Hernandez"],
  },
  {
    nat: "JAM",
    first: ["Michail", "Leon", "Demarai", "Bobby", "Shamar", "Damion", "Ethan", "Andre", "Kasey", "Dexter", "Kemar", "Ravel", "Amari", "Di'Shon", "Greg"],
    last: ["Antonio", "Bailey", "Gray", "Reid", "Nicholson", "Lowe", "Pinnock", "Blake", "Palmer", "Lembikisa", "Lawrence", "Morrison", "Bennett", "Bernard", "Leigh", "Mattocks", "Brown", "Latibeaudiere", "Thomas", "McCleary"],
  },
  {
    nat: "TRI",
    first: ["Levi", "Alvin", "Reon", "Kevin", "Aubrey", "Nathaniel", "Justin", "Daniel", "Joevin", "Ryan", "Andre", "Malcolm", "Noah", "Sheldon", "Marvin"],
    last: ["Garcia", "Jones", "Moore", "Molino", "David", "James", "Garcia", "Phillips", "Jones", "Telfer", "Rampersad", "Shaw", "Powder", "Bateau", "Phillip", "Hackshaw", "Fraser", "Boucaud", "Lee", "Peltier"],
  },
  {
    nat: "HAI",
    first: ["Duckens", "Frantzdy", "Derrick", "Carlens", "Steeven", "Ricardo", "Danley", "Josue", "Wilde-Donald", "Zachary", "Johny", "Andrew", "Mondy", "Leverton", "Garven"],
    last: ["Nazon", "Pierrot", "Etienne", "Arcus", "Saintini", "Ade", "Jean", "Duverger", "Guerrier", "Herivaux", "Placide", "Jean-Baptiste", "Prince", "Pierre", "Metelus", "Jules", "Alexis", "Cadet", "Charles", "Louis"],
  },
  {
    nat: "DOM",
    first: ["Mariano", "Junior", "Peter", "Edarlyn", "Angelo", "Dorny", "Jimmy", "Heinz", "Oscar", "Joan", "Ronaldo", "Ricardo", "Jean Carlos", "Edison", "Carlos"],
    last: ["Diaz", "Firpo", "Gonzalez", "Reyes", "Faringthon", "Romero", "Kelly", "Morel", "Ureña", "Cuevas", "Vasquez", "Rodriguez", "Bautista", "Azcona", "Ventura", "Perez", "Almonte", "Martinez", "Guzman", "Encarnacion"],
  },
  {
    nat: "PUR",
    first: ["Leandro", "Jeremy", "Wilfredo", "Ricardo", "Sidney", "Christopher", "Gerald", "Steven", "Nicolas", "Alexander", "Jason", "Joseph", "Bryan", "Ismael", "Carlos"],
    last: ["Antonetti", "Rivera", "Rivera", "Rivera", "Rijo", "Perez", "Diaz", "Echevarria", "Cardona", "Rivera", "Perez", "Morales", "Torres", "Cruz", "Ortiz", "Santiago", "Ramos", "Colon", "Vega", "Marrero"],
  },
  {
    nat: "GRN",
    first: ["Jamal", "Myles", "Saydrel", "Shavon", "Regan", "Aaron", "Tyrone", "Kellon", "Cassim", "Jaden", "Delron", "Anthony", "Kern", "Odell", "Shane"],
    last: ["Charles", "Weekes", "Laurent", "John", "Charles", "Pierre", "Bishop", "Baptiste", "Langaigne", "Frank", "Langdon", "Straker", "Cyrus", "Sylvester", "Modeste"],
  },
  {
    nat: "ATG",
    first: ["Peter", "Quinton", "Myles", "Tevaughn", "Kerry", "Javorn", "Vurlon", "Jamie", "Dexter", "Zaine", "George", "Kalique", "Randolph", "Rowan", "Micah"],
    last: ["Byers", "Griffith", "Weston", "Harris", "Skepple", "Buckley", "Mitchell", "Thomas", "Blackman", "Griffith", "Dublin", "Mendes", "Burton", "Benjamin", "Roberts"],
  },
  {
    nat: "LCA",
    first: ["Tremain", "Kurt", "Zachary", "Malik", "Jamil", "Andrus", "Vino", "Kevin", "Shide", "Cassius", "Terry", "Nathan", "Rickel", "Justin", "Tafari"],
    last: ["Paul", "Frederick", "Reid", "St Rose", "Joseph", "Remy", "Barnard", "Charles", "Hippolyte", "Fontenelle", "Charlemagne", "Emmanuel", "Mathurin", "Elva", "Sylvester"],
  },
  {
    nat: "STV",
    first: ["Oalex", "Cornelius", "Azaria", "Kishron", "Tevin", "Jarvis", "Myron", "Kaiwan", "Jevani", "Ranaldo", "Kimenio", "Kenroy", "Justin", "Damani", "Shandel"],
    last: ["Anderson", "Stewart", "Stewart", "Samuel", "Slater", "Providence", "Samuel", "Charles", "Layne", "Charles", "Cordice", "Samuel", "Chandler", "Samuel", "Bailey"],
  },
  {
    nat: "GUY",
    first: ["Neil", "Emery", "Liam", "Omari", "Callum", "Terrence", "Keanu", "Daniel", "Sam", "Jeremy", "Trayon", "Stephen", "Deon", "Ryan", "Colin"],
    last: ["Danns", "Welch", "Gordon", "Glasgow", "Harriott", "Vancooten", "Marks", "Wilson", "Cox", "Garrett", "Bobb", "Duke", "Moore", "Hackett", "Nelson"],
  },
  {
    nat: "SUR",
    first: ["Sheraldo", "Gleofilo", "Ridgeciano", "Damil", "Kelvin", "Justin", "Ryan", "Diego", "Shaquille", "Tjaronn", "Ivenzo", "Dhoraso", "Warner", "Nigel", "Anfernee"],
    last: ["Becker", "Vlijter", "Haps", "Dankerlui", "Leerdam", "Lonwijk", "Donk", "Biseswar", "Pinas", "Chery", "Comvalius", "Klas", "Hahn", "Hasselbaink", "Dijksteel"],
  },
  {
    nat: "CUW",
    first: ["Leandro", "Juninho", "Jurien", "Rangelo", "Cuco", "Livano", "Jeremy", "Kenji", "Darren", "Roshon", "Sontje", "Shanon", "Brandley", "Charlison", "Elson"],
    last: ["Bacuna", "Bacuna", "Bacuna", "Janga", "Martina", "Comvalius", "Antonia", "Gorre", "Sidberry", "van Zutphen", "Hansen", "Carmelia", "Kuwas", "Benschop", "Hooi"],
  },
  {
    nat: "GLP",
    first: "Dimitri Mickael Ludovic Stephane Ronald Kevin Thomas Matthias Raphael Jordy Yohann Anthony Marvin Loick Cedric".split(" "),
    last: "Cabrera Tacalfred Baal Auvray Zinga Phaeton Gamiette Phaeton Nabab Delos Rene Vermont Baal Landre Sainte-Luce".split(" "),
  },
  {
    nat: "GUF",
    first: "Florent Sloan Rhudy Kevin Ludovic Yann Dimitri Marvin Steven Loic Gregory Jordan Yannick Christopher Alexandre".split(" "),
    last: "Malouda Privat Evens Rimane Baal Charles Karamoko Jean-Baptiste Long Nelson Aristide Cadette Boutin Aubin Damas".split(" "),
  },
  {
    nat: "MTQ",
    first: "Kevin Emmanuel Steeven Daniel Yoann Karl Samuel Jordy Stephane Brighton Mathias Loris Gaetan Dylan Fabien".split(" "),
    last: "Parsemain Riviere Langil Herelle Arcus Vitre Camille Delos Abaul Labaste Coco Nelson Robail Bellegarde Roy".split(" "),
  },

  // ── South America (remaining) ──
  {
    nat: "URU",
    first: ["Luis", "Federico", "Darwin", "Ronald", "Rodrigo", "Matias", "Nicolas", "Manuel", "Facundo", "Giorgian", "Sebastian", "Maxi", "Jose Maria", "Agustin", "Brian"],
    last: ["Suarez", "Valverde", "Nunez", "Araujo", "Bentancur", "Vecino", "De La Cruz", "Ugarte", "Torreira", "De Arrascaeta", "Coates", "Gomez", "Gimenez", "Canobbio", "Rodriguez"],
  },
  {
    nat: "CHI",
    first: ["Alexis", "Arturo", "Charles", "Ben", "Erick", "Claudio", "Guillermo", "Diego", "Marcelino", "Gabriel", "Victor", "Dario", "Eduardo", "Cesar", "Felipe"],
    last: ["Sanchez", "Vidal", "Aranguiz", "Brereton", "Pulgar", "Bravo", "Maripan", "Valdes", "Nunez", "Suazo", "Davila", "Osorio", "Vargas", "Perez", "Loyola"],
  },
  {
    nat: "PER",
    first: ["Paolo", "Christian", "Renato", "Andre", "Gianluca", "Yoshimar", "Luis", "Edison", "Alex", "Sergio", "Bryan", "Piero", "Marcos", "Wilder", "Miguel"],
    last: ["Guerrero", "Cueva", "Tapia", "Carrillo", "Lapadula", "Yotun", "Advincula", "Flores", "Valera", "Pena", "Reyna", "Quispe", "Lopez", "Cartagena", "Araujo"],
  },
  {
    nat: "ECU",
    first: ["Enner", "Moises", "Piero", "Pervis", "Gonzalo", "Angelo", "Kendry", "Jeremy", "Felix", "Alan", "Jhegson", "Jordy", "Michael", "Hernan", "Alexander"],
    last: ["Valencia", "Caicedo", "Hincapie", "Estupinan", "Plata", "Preciado", "Paez", "Sarmiento", "Torres", "Franco", "Mendez", "Caicedo", "Estrada", "Galindez", "Dominguez"],
  },
  {
    nat: "PAR",
    first: ["Miguel", "Angel", "Gustavo", "Julio", "Junior", "Robert", "Ramon", "Andres", "Mathias", "Diego", "Braian", "Alberto", "Damian", "Omar", "Fabian"],
    last: ["Almiron", "Romero", "Gomez", "Enciso", "Alonso", "Morales", "Sosa", "Cubas", "Villasanti", "Gomez", "Ojeda", "Espinola", "Bobadilla", "Alderete", "Balbuena"],
  },
  {
    nat: "BOL",
    first: ["Marcelo", "Carmelo", "Ramiro", "Bruno", "Roberto", "Diego", "Henry", "Moises", "Gabriel", "Luis", "Jaume", "Boris", "Miguel", "Erwin", "Leonel"],
    last: ["Martins", "Algaranaz", "Vaca", "Miranda", "Fernandez", "Bejarano", "Vaca", "Villarroel", "Villamil", "Haquin", "Cuellar", "Cespedes", "Terceros", "Saucedo", "Justiniano"],
  },
  {
    nat: "VEN",
    first: ["Salomon", "Josef", "Yeferson", "Darwin", "Jefferson", "Tomas", "Yangel", "Jhon", "Eduard", "Wilker", "Nahuel", "Jose", "Cristian", "Alexander", "Jan"],
    last: ["Rondon", "Martinez", "Soteldo", "Machis", "Savarino", "Rincon", "Herrera", "Murillo", "Bello", "Angel", "Ferraresi", "Andrade", "Casseres", "Gonzalez", "Hurtado"],
  },

  // ── West Asia / Middle East ──
  {
    nat: "IRN",
    first: ["Sardar", "Mehdi", "Alireza", "Saman", "Karim", "Ramin", "Milad", "Saeid", "Ali", "Shoja", "Majid", "Omid", "Hossein", "Mohammad", "Vahid"],
    last: ["Azmoun", "Taremi", "Jahanbakhsh", "Ghoddos", "Ansarifard", "Rezaeian", "Mohammadi", "Ezatolahi", "Gholizadeh", "Khalilzadeh", "Hosseini", "Noorafkan", "Kanaani", "Torabi", "Amiri"],
  },
  {
    nat: "IRQ",
    first: ["Mohanad", "Aymen", "Ali", "Bashar", "Ibrahim", "Amjad", "Osama", "Hussein", "Sherko", "Zidane", "Mustafa", "Rebin", "Frans", "Ahmed", "Alaa"],
    last: ["Ali", "Hussein", "Adnan", "Resan", "Bayesh", "Attwan", "Rashid", "Ali", "Karim", "Iqbal", "Nadhim", "Sulaka", "Putros", "Yahya", "Abbas"],
  },
  {
    nat: "ISR",
    first: ["Manor", "Eran", "Munas", "Oscar", "Dor", "Mohammad", "Bibras", "Dia", "Tai", "Gavriel", "Sun", "Neta", "Ilay", "Anan", "Doron"],
    last: ["Solomon", "Zahavi", "Dabbur", "Gloukh", "Peretz", "Abu Fani", "Natcho", "Saba", "Baribo", "Kanichowsky", "Menachem", "Lavi", "Feingold", "Khalaili", "Leidner"],
  },
  {
    nat: "JOR",
    first: ["Musa", "Yazan", "Mahmoud", "Ali", "Nizar", "Ehsan", "Yazan", "Rajaei", "Mousa", "Abdallah", "Noor", "Ibrahim", "Salem", "Feras", "Anas"],
    last: ["Al-Taamari", "Al-Naimat", "Al-Mardi", "Olwan", "Al-Rashdan", "Haddad", "Al-Arab", "Ayed", "Al-Tamari", "Nasib", "Al-Rawabdeh", "Sadeh", "Al-Ajalin", "Shalbaya", "Bani Yaseen"],
  },
  {
    nat: "SYR",
    first: ["Omar", "Mahmoud", "Ibrahim", "Aias", "Fahd", "Khaled", "Mohammad", "Ammar", "Alaa", "Pablo", "Ezequiel", "Yousef", "Kamel", "Jalil", "Hamid"],
    last: ["Khribin", "Al-Mawas", "Alma", "Aosman", "Youssef", "Al-Mbayed", "Marmour", "Ramadan", "Al-Dali", "Sabbag", "Ham", "Kalfa", "Hmeisheh", "Elias", "Mido"],
  },
  {
    nat: "PLE",
    first: ["Oday", "Layth", "Tamer", "Mahmoud", "Mohammed", "Islam", "Musab", "Wessam", "Yaser", "Zaid", "Shehab", "Ataa", "Camilo", "Amid", "Khaled"],
    last: ["Dabbagh", "Kharoub", "Seyam", "Abu Warda", "Rashid", "Batran", "Battat", "Abu Ali", "Islaih", "Qumbor", "Qunbar", "Jabr", "Saldana", "Mahajna", "Nassar"],
  },
  {
    nat: "UZB",
    first: ["Eldor", "Jaloliddin", "Odiljon", "Abbosbek", "Otabek", "Azizbek", "Husniddin", "Islom", "Rustam", "Oston", "Jasurbek", "Sardor", "Bobur", "Farrukh", "Utkir"],
    last: ["Shomurodov", "Masharipov", "Hamrobekov", "Fayzullaev", "Shukurov", "Turgunboev", "Alijonov", "Kobilov", "Ashurmatov", "Urunov", "Jaloliddinov", "Sayfiev", "Abdixolikov", "Sayfiev", "Yusupov"],
  },

  // ── East & Southeast Asia ──
  {
    nat: "CHN",
    first: ["Wu", "Wei", "Zhang", "Wang", "Zhu", "Yan", "Gao", "Xu", "Tan", "Lin", "Liu", "Jiang", "Chen", "Dai", "Feng"],
    last: ["Lei", "Shihao", "Yuning", "Shangyuan", "Chenjie", "Junling", "Zhunyi", "Xin", "Long", "Liangming", "Binbin", "Guangtai", "Pu", "Weijun", "Boxuan"],
  },
  {
    nat: "IDN",
    first: ["Egy", "Marselino", "Witan", "Asnawi", "Pratama", "Rizky", "Jordi", "Sandy", "Ivar", "Ramadhan", "Dendy", "Yakob", "Rachmat", "Arhan", "Elkan"],
    last: ["Maulana", "Ferdinan", "Sulaeman", "Mangkualam", "Arhan", "Ridho", "Amat", "Walsh", "Jenner", "Sananta", "Sumardi", "Sayuri", "Irianto", "Pratama", "Baggott"],
  },
  {
    nat: "PHI",
    first: ["Neil", "Bienvenido", "Patrick", "Amani", "Kevin", "Michael", "Sandro", "Jefferson", "Oskari", "Jarvey", "Jaime", "Justin", "Mike", "Manuel", "Christian"],
    last: ["Etheridge", "Maranon", "Reichelt", "Aguinaldo", "Ingreso", "Kempter", "Reyes", "Tabinas", "Kekkonen", "Gayoso", "Rosquillo", "Baas", "Ott", "Ott", "Rontini"],
  },

  // ── Oceania ──
  {
    nat: "NZL",
    first: ["Chris", "Marko", "Matthew", "Liberato", "Michael", "Callum", "Bill", "Joe", "Ben", "Sarpreet", "Elijah", "Alex", "Tim", "Storm", "Clayton"],
    last: ["Wood", "Stamenic", "Garbett", "Cacace", "Boxall", "McCowatt", "Tuiloma", "Bell", "Waine", "Singh", "Just", "Paulsen", "Payne", "Roux", "Lewis"],
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
