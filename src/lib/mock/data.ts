export const business = {
  name: "Mörby Fotvård och Skönhet",
  location: "Danderyd, Stockholm",
  website: "https://morbyfotvard.se",
  targetKeyword: "ansiktsbehandling danderyd",
  mode: "Demo Mode"
};

export const metrics = [
  { label: "Estimated local rank", value: "#3", delta: "+2 positions", note: "Target: Knowledge Panel visibility" },
  { label: "GBP optimization", value: "72%", delta: "+18% potential", note: "Categories, services and posts need work" },
  { label: "Reviews", value: "98", delta: "14 facial mentions", note: "Goal: 35+ ansiktsbehandling mentions" },
  { label: "90-day progress", value: "18%", delta: "Week 2 active", note: "Foundation phase" }
];

export const rankingTrend = [
  { week: "W1", rank: 8 }, { week: "W2", rank: 6 }, { week: "W3", rank: 5 },
  { week: "W4", rank: 4 }, { week: "W5", rank: 3 }, { week: "Now", rank: 3 }
];

export const reviewsGrowth = [
  { month: "Jan", reviews: 82, facial: 5 }, { month: "Feb", reviews: 86, facial: 7 },
  { month: "Mar", reviews: 90, facial: 10 }, { month: "Apr", reviews: 95, facial: 12 },
  { month: "May", reviews: 98, facial: 14 }
];

export const tasksProgress = [
  { name: "Done", value: 18 }, { name: "In progress", value: 9 }, { name: "Pending", value: 63 }
];

export const priorityTasks = [
  { title: "Rewrite ansiktsbehandling service page H1/H2", priority: "High", impact: "High", category: "Content" },
  { title: "Publish GBP post focused on facial treatments", priority: "High", impact: "Medium", category: "GBP" },
  { title: "Ask 5 recent facial clients for reviews", priority: "Critical", impact: "High", category: "Reviews" },
  { title: "Add local FAQ schema to facial page", priority: "Medium", impact: "Medium", category: "Technical SEO" }
];

export const competitors = [
  {
    name: "Angelly Beauty",
    rating: 4.8,
    reviews: 126,
    strength: 88,
    relevance: 92,
    strengths: ["Strong beauty positioning", "High review volume", "Clear facial treatment identity"],
    weaknesses: ["Generic local content", "Limited educational FAQ depth"],
    opportunities: ["Build deeper Danderyd-specific facial content", "Increase facial-treatment reviews", "Publish consistent GBP posts"]
  },
  {
    name: "Danderyd Hudvård",
    rating: 4.6,
    reviews: 74,
    strength: 71,
    relevance: 85,
    strengths: ["Relevant skincare name", "Focused treatment offer"],
    weaknesses: ["Lower review volume", "Less authority than Angelly"],
    opportunities: ["Outperform with better page structure", "Add service comparison content"]
  },
  {
    name: "Beauty Clinic Stockholm",
    rating: 4.5,
    reviews: 112,
    strength: 76,
    relevance: 68,
    strengths: ["Broader brand reach", "Good visual identity"],
    weaknesses: ["Less Danderyd-specific", "Facial page not locally focused"],
    opportunities: ["Own the Danderyd query", "Reinforce proximity and trust signals"]
  }
];

export const gbpChecklist = [
  { item: "Primary and secondary categories reviewed", status: "In progress" },
  { item: "Ansiktsbehandling added as a core service", status: "Pending" },
  { item: "Weekly Google posts calendar", status: "Pending" },
  { item: "Facial treatment photos uploaded", status: "In progress" },
  { item: "Review request process for facial clients", status: "Pending" },
  { item: "Service descriptions optimized in Swedish", status: "Pending" }
];

export const contentIdeas = [
  {
    type: "Meta title",
    text: "Ansiktsbehandling i Danderyd | Mörby Fotvård och Skönhet"
  },
  {
    type: "Meta description",
    text: "Professionell ansiktsbehandling i Danderyd med fokus på hudvård, lyster och personlig service. Boka din behandling hos Mörby Fotvård och Skönhet."
  },
  {
    type: "H1",
    text: "Ansiktsbehandling i Danderyd för en friskare och mer balanserad hud"
  },
  {
    type: "FAQ",
    text: "Vilken ansiktsbehandling passar min hudtyp? Vi hjälper dig att välja rätt behandling utifrån hudens behov, känslighet och mål."
  },
  {
    type: "GBP Post",
    text: "Ge huden ny lyster med en professionell ansiktsbehandling i Danderyd. Hos Mörby Fotvård och Skönhet får du personlig hudvård i en lugn och trygg miljö."
  }
];

export const reviews = [
  { author: "Demo Customer", rating: 5, service: "ansiktsbehandling", text: "Fantastisk ansiktsbehandling i Danderyd. Professionellt och varmt bemötande.", suggestedReply: "Tack så mycket för din fina recension! Vi är glada att du uppskattade din ansiktsbehandling hos oss i Danderyd." },
  { author: "Demo Customer 2", rating: 5, service: "fotvård", text: "Mycket nöjd med fotvård och service.", suggestedReply: "Stort tack för dina fina ord. Varmt välkommen tillbaka till oss!" },
  { author: "Demo Customer 3", rating: 4, service: "hudvård", text: "Trevlig behandling och bra rådgivning om huden.", suggestedReply: "Tack för din recension. Vi är glada att du uppskattade behandlingen och rådgivningen." }
];

export const plan = Array.from({ length: 13 }, (_, i) => ({
  week: i + 1,
  focus: ["Audit", "Content", "Reviews", "GBP", "Authority", "Reporting"][i % 6],
  tasks: [
    { title: `Week ${i + 1}: improve local entity signals`, priority: i < 4 ? "High" : "Medium", impact: "High", difficulty: i % 3 === 0 ? "Medium" : "Low", status: i < 2 ? "completed" : i === 2 ? "in_progress" : "pending" },
    { title: `Week ${i + 1}: publish Swedish content/update`, priority: "Medium", impact: "Medium", difficulty: "Low", status: i < 1 ? "completed" : "pending" }
  ]
}));

export const agents = [
  { id: "local-seo", name: "Local SEO Auditor Agent", role: "Audits site, local signals, page structure and ranking opportunities.", status: "Ready", lastRun: "Demo never", output: "Prioritize ansiktsbehandling landing page and local schema." },
  { id: "gbp", name: "Google Business Profile Agent", role: "Optimizes services, categories, posts, photos and review signals.", status: "Ready", lastRun: "Demo never", output: "Add facial services and weekly Swedish posts." },
  { id: "competitor", name: "Competitor Intelligence Agent", role: "Compares Mörby against Angelly Beauty and nearby competitors.", status: "Ready", lastRun: "Demo never", output: "Angelly wins on reviews and service identity." },
  { id: "content", name: "Content Strategy Agent", role: "Generates Swedish SEO copy, FAQs, posts and landing page recommendations.", status: "Ready", lastRun: "Demo never", output: "Use hudvård, ansiktsvård, Danderyd and trust terms naturally." },
  { id: "review", name: "Review Growth Agent", role: "Designs review acquisition campaigns and response suggestions.", status: "Ready", lastRun: "Demo never", output: "Request facial-specific reviews after each treatment." },
  { id: "entity", name: "Entity Optimization Agent", role: "Strengthens brand association with facial treatments in Danderyd.", status: "Ready", lastRun: "Demo never", output: "Align website, GBP, reviews and content around ansiktsbehandling." },
  { id: "reporting", name: "Reporting Agent", role: "Creates executive and operational SEO reports.", status: "Ready", lastRun: "Demo never", output: "Weekly report should focus on actions, rankings and reviews." },
  { id: "planner", name: "Task Planner Agent", role: "Turns insights into a 90-day execution plan.", status: "Ready", lastRun: "Demo never", output: "Follow weekly sprint structure with priority tasks." }
];
