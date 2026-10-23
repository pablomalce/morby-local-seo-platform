/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el validador de JSON-LD de la auditoría AEO dé por bueno un `@type` que
 * schema.org no define (F6). Antes sólo se miraba que existiera: `"Bananaa"`
 * salía «Schema verificable: VERDE», que es el modo de falla «sólo por
 * presencia» que nombra la puerta H2-GO-1, un nivel más abajo.
 *
 * ES UNA INSTANTÁNEA, NO UNA CONSULTA. Las 940 clases de schema.org que trae
 * `schema-dts` 2.0.0 (Apache-2.0; el vocabulario es de schema.org, CC BY-SA
 * 3.0): cada `"@type": "…"` de su `dist/schema.d.ts`, y los dos subárboles
 * expandiendo sus uniones (`export type LocalBusiness = LocalBusinessLeaf |
 * AnimalShelter | …`). Extraída el 2026-10-13 de la copia que ya estaba en
 * disco (`vulkan-web/node_modules/schema-dts`), sin bajar nada. Para
 * actualizarla, repetir esa extracción con una versión nueva de `schema-dts`:
 * un tipo que schema.org agregue después sale como error hasta entonces, y eso
 * es un rojo de más, nunca un verde de más.
 */

/** Cada clase de schema.org: lo que puede ir en `@type`. */
export const CLASES_DE_SCHEMA_ORG: ReadonlySet<string> = new Set(
  `
  3DModel AMRadioChannel APIReference AboutPage AcceptAction Accommodation AccountingService
  AchieveAction Action ActionAccessSpecification ActionStatusType ActivateAction AddAction
  AdministrativeArea AdultEntertainment AdultOrientedEnumeration AdvertiserContentArticle
  AggregateOffer AggregateRating AgreeAction Airline Airport AlignmentObject AllocateAction
  AmpStory AmusementPark AnalysisNewsArticle AnatomicalStructure AnatomicalSystem AnimalShelter
  Answer Apartment ApartmentComplex AppendAction ApplyAction ApprovedIndication Aquarium
  ArchiveComponent ArchiveOrganization ArriveAction ArtGallery Artery Article AskAction
  AskPublicNewsArticle AssessAction AssignAction Atlas Attorney Audience AudioObject
  AudioObjectSnapshot Audiobook AuthenticateAction AuthorizeAction AutoBodyShop AutoDealer
  AutoPartsStore AutoRental AutoRepair AutoWash AutomatedTeller AutomotiveBusiness
  BackgroundNewsArticle Bakery BankAccount BankOrCreditUnion BarOrPub Barcode Beach BeautySalon
  BedAndBreakfast BedDetails BedType BefriendAction BikeStore BioChemEntity Blog BlogPosting
  BloodTest BoardingPolicyType BoatReservation BoatTerminal BoatTrip
  BodyMeasurementTypeEnumeration BodyOfWater Bone Book BookFormatType BookSeries BookStore
  BookmarkAction BorrowAction BowlingAlley BrainStructure Brand BreadcrumbList Brewery Bridge
  BroadcastChannel BroadcastEvent BroadcastFrequencySpecification BroadcastService
  BrokerageAccount BuddhistTemple BusOrCoach BusReservation BusStation BusStop BusTrip
  BusinessAudience BusinessEntityType BusinessEvent BusinessFunction BuyAction CDCPMDRecord
  CableOrSatelliteService CafeOrCoffeeShop Campground CampingPitch Canal CancelAction Car
  CarUsageType Casino CategoryCode CategoryCodeSet CatholicChurch Cemetery Certification
  CertificationStatusEnumeration Chapter CheckAction CheckInAction CheckOutAction CheckoutPage
  ChemicalSubstance ChildCare ChildrensEvent ChooseAction Church City CityHall CivicStructure
  Claim ClaimReview Class Clip ClothingStore Code Collection CollectionPage CollegeOrUniversity
  ComedyClub ComedyEvent ComicCoverArt ComicIssue ComicSeries ComicStory Comment CommentAction
  CommunicateAction CommunityHealth CompleteDataFeed CompoundPriceSpecification ComputerLanguage
  ComputerStore ConferenceEvent ConfirmAction Consortium ConstraintNode ConsumeAction ContactPage
  ContactPoint ContactPointOption Continent ControlAction ConvenienceStore Conversation CookAction
  Cooperative Corporation CorrectionComment Country Course CourseInstance Courthouse CoverArt
  CovidTestingFacility CreateAction CreativeWork CreativeWorkSeason CreativeWorkSeries Credential
  CreditCard Crematorium CriticReview CurrencyConversionService DDxElement DENonprofitType
  DanceEvent DanceGroup DataCatalog DataDownload DataFeed DataFeedItem Dataset
  DatedMoneySpecification DayOfWeek DaySpa DeactivateAction DefenceEstablishment DefinedRegion
  DefinedTerm DefinedTermSet DeleteAction DeliveryChargeSpecification DeliveryEvent DeliveryMethod
  DeliveryTimeSettings Demand Dentist DepartAction DepartmentStore DepositAccount Dermatology
  DiagnosticLab DiagnosticProcedure Diet DietNutrition DietarySupplement DigitalDocument
  DigitalDocumentPermission DigitalDocumentPermissionType DigitalPlatformEnumeration
  DisagreeAction DiscoverAction DiscussionForumPosting DislikeAction Distillery DonateAction
  DoseSchedule DownloadAction DrawAction Drawing DrinkAction DriveWheelConfigurationValue Drug
  DrugClass DrugCost DrugCostCategory DrugLegalStatus DrugPregnancyCategory DrugPrescriptionStatus
  DrugStrength DryCleaningOrLaundry EUEnergyEfficiencyEnumeration EatAction EducationEvent
  EducationalAudience EducationalOccupationalCredential EducationalOccupationalProgram
  EducationalOrganization Electrician ElectronicsStore ElementarySchool EmailMessage Embassy
  Emergency EmergencyService EmployeeRole EmployerAggregateRating EmployerReview EmploymentAgency
  EndorseAction EndorsementRating EnergyConsumptionDetails EnergyEfficiencyEnumeration
  EnergyStarEnergyEfficiencyEnumeration EngineSpecification EntertainmentBusiness EntryPoint
  Enumeration Episode Error Event EventAttendanceModeEnumeration EventReservation EventSeries
  EventStatusType EventVenue ExchangeRateSpecification ExerciseAction ExerciseGym ExercisePlan
  ExhibitionEvent FAQPage FMRadioChannel FastFoodRestaurant Festival FilmAction FinancialIncentive
  FinancialProduct FinancialService FindAction FireStation Flight FlightReservation FloorPlan
  Florist FollowAction FoodEstablishment FoodEstablishmentReservation FoodEvent FoodService
  FulfillmentTypeEnumeration FundingAgency FundingScheme FurnitureStore Game
  GameAvailabilityEnumeration GamePlayMode GameServer GameServerStatus GardenStore GasStation
  GatedResidenceCommunity GenderType Gene GeneralContractor GeoCircle GeoCoordinates GeoShape
  GeospatialGeometry Geriatric GiveAction GolfCourse GovernmentBenefitsType GovernmentBuilding
  GovernmentOffice GovernmentOrganization GovernmentPermit GovernmentService Grant GroceryStore
  Guide Gynecologic HVACBusiness Hackathon HairSalon HardwareStore HealthAndBeautyBusiness
  HealthAspectEnumeration HealthClub HealthInsurancePlan HealthPlanCostSharingSpecification
  HealthPlanFormulary HealthPlanNetwork HealthTopicContent HighSchool HinduTemple HobbyShop
  HomeAndConstructionBusiness HomeGoodsStore Hospital Hostel Hotel HotelRoom House HousePainter
  HowTo HowToDirection HowToItem HowToSection HowToStep HowToSupply HowToTip HowToTool HyperToc
  HyperTocEntry IPTCDigitalSourceEnumeration ITNonprofitType IceCreamShop IgnoreAction
  ImageGallery ImageObject ImageObjectSnapshot ImagingTest IncentiveQualifiedExpenseType
  IncentiveStatus IncentiveType IndividualPhysician IndividualProduct InfectiousAgentClass
  InfectiousDisease InformAction InsertAction InstallAction InstantaneousEvent InsuranceAgency
  Intangible InteractAction InteractionCounter InternetCafe InvestmentFund InvestmentOrDeposit
  InviteAction Invoice ItemAvailability ItemList ItemListOrderType ItemPage JewelryStore
  JobPosting JoinAction Joint LakeBodyOfWater Landform LandmarksOrHistoricalBuildings Language
  LearningResource LeaveAction LegalForceStatus LegalService LegalValueLevel Legislation
  LegislationObject LegislativeBuilding LendAction Library LibrarySystem LifestyleModification
  Ligament LikeAction LinkRole LiquorStore ListItem ListenAction LiteraryEvent LiveBlogPosting
  LoanOrCredit LocalBusiness LocationFeatureSpecification Locksmith LodgingBusiness
  LodgingReservation LoginAction LoseAction LymphaticVessel Manuscript Map MapCategoryType
  MarryAction MathSolver MaximumDoseSchedule MeasurementMethodEnum MeasurementTypeEnumeration
  MediaEnumeration MediaGallery MediaManipulationRatingEnumeration MediaObject MediaReview
  MediaReviewItem MediaSubscription MedicalAudience MedicalAudienceType MedicalBusiness
  MedicalCause MedicalClinic MedicalCode MedicalCondition MedicalConditionStage
  MedicalContraindication MedicalDevice MedicalDevicePurpose MedicalEntity MedicalEnumeration
  MedicalEvidenceLevel MedicalGuideline MedicalGuidelineContraindication
  MedicalGuidelineRecommendation MedicalImagingTechnique MedicalIndication MedicalIntangible
  MedicalObservationalStudy MedicalObservationalStudyDesign MedicalOrganization MedicalProcedure
  MedicalProcedureType MedicalRiskCalculator MedicalRiskEstimator MedicalRiskFactor
  MedicalRiskScore MedicalScholarlyArticle MedicalSign MedicalSignOrSymptom MedicalSpecialty
  MedicalStudy MedicalStudyStatus MedicalSymptom MedicalTest MedicalTestPanel MedicalTherapy
  MedicalTrial MedicalTrialDesign MedicalWebPage MedicineSystem MeetingRoom MemberProgram
  MemberProgramTier MensClothingStore Menu MenuItem MenuSection MerchantReturnEnumeration
  MerchantReturnPolicy MerchantReturnPolicySeasonalOverride Message MiddleSchool Midwifery
  MobileApplication MobilePhoneStore MolecularEntity MonetaryAmount MonetaryAmountDistribution
  MonetaryGrant MoneyTransfer MortgageLoan Mosque Motel Motorcycle MotorcycleDealer
  MotorcycleRepair MotorizedBicycle Mountain MoveAction Movie MovieClip MovieRentalStore
  MovieSeries MovieTheater MovingCompany Muscle Museum MusicAlbum MusicAlbumProductionType
  MusicAlbumReleaseType MusicComposition MusicEvent MusicGroup MusicPlaylist MusicRecording
  MusicRelease MusicReleaseFormatType MusicStore MusicVenue MusicVideoObject NGO NLNonprofitType
  NailSalon Nerve NewsArticle NewsMediaOrganization Newspaper NightClub NonprofitType Notary
  NoteDigitalDocument Nursing NutritionInformation Observation Obstetric Occupation
  OccupationalExperienceRequirements OccupationalTherapy OceanBodyOfWater Offer OfferCatalog
  OfferForLease OfferForPurchase OfferItemCondition OfferShippingDetails OfficeEquipmentStore
  OnDemandEvent Oncologic OnlineBusiness OnlineMarketplace OnlineStore OpeningHoursSpecification
  OperatingSystem OpinionNewsArticle Optician Optometric Order OrderAction OrderItem OrderStatus
  Organization OrganizationRole OrganizeAction Otolaryngologic OutletStore OwnershipInfo
  PaintAction Painting PalliativeProcedure ParcelDelivery ParentAudience Park ParkingFacility
  PathologyTest Patient PawnShop PayAction PaymentCard PaymentChargeSpecification PaymentMethod
  PaymentMethodType PaymentService PaymentStatusType Pediatric PeopleAudience PerformAction
  PerformanceRole PerformingArtsEvent PerformingArtsTheater PerformingGroup Periodical Permit
  Person PetStore Pharmacy Photograph PhotographAction PhysicalActivity PhysicalActivityCategory
  PhysicalExam PhysicalTherapy Physician PhysiciansOffice Physiotherapy Place PlaceOfWorship
  PlanAction PlasticSurgery Play PlayAction PlayGameAction Playground Plumber PodcastEpisode
  PodcastSeason PodcastSeries Podiatric PoliceStation PoliticalParty Pond PostOffice PostalAddress
  PostalCodeRangeSpecification Poster PreOrderAction PrependAction Preschool
  PresentationDigitalDocument PreventionIndication PriceComponentTypeEnumeration
  PriceSpecification PriceTypeEnumeration PrimaryCare Product ProductCollection ProductGroup
  ProductModel ProductReturnEnumeration ProductReturnPolicy ProfessionalService ProfilePage
  ProgramMembership Project PronounceableText Property PropertyValue PropertyValueSpecification
  Protein Psychiatric PsychologicalTreatment PublicHealth PublicSwimmingPool PublicToilet
  PublicationEvent PublicationIssue PublicationVolume PurchaseType QAPage QualitativeValue
  QuantitativeValue QuantitativeValueDistribution Question Quiz Quotation QuoteAction RVPark
  RadiationTherapy RadioBroadcastService RadioChannel RadioClip RadioEpisode RadioSeason
  RadioSeries RadioStation Rating ReactAction ReadAction RealEstateAgent RealEstateListing
  ReceiveAction Recipe Recommendation RecommendedDoseSchedule RecyclingCenter
  RefundTypeEnumeration RegisterAction RejectAction RentAction RentalCarReservation
  RepaymentSpecification ReplaceAction ReplyAction Report ReportageNewsArticle
  ReportedDoseSchedule ResearchOrganization ResearchProject Researcher Reservation
  ReservationPackage ReservationStatusType ReserveAction Reservoir ResetPasswordAction Residence
  Resort RespiratoryTherapy Restaurant RestrictedDiet ResumeAction ReturnAction
  ReturnFeesEnumeration ReturnLabelSourceEnumeration ReturnMethodEnumeration Review ReviewAction
  ReviewNewsArticle RiverBodyOfWater Role RoofingContractor Room RsvpAction RsvpResponseType
  RuntimePlatform SaleEvent SatiricalArticle Schedule ScheduleAction ScholarlyArticle School
  SchoolDistrict ScreeningEvent Sculpture SeaBodyOfWater SearchAction SearchRescueOrganization
  SearchResultsPage Season Seat SeekToAction SelfStorage SellAction SendAction SequentialArt
  Series Service ServiceChannel ServicePeriod ShareAction SheetMusic ShippingConditions
  ShippingDeliveryTime ShippingRateSettings ShippingService ShoeStore ShoppingCenter ShortStory
  SingleFamilyResidence SiteNavigationElement SizeGroupEnumeration SizeSpecification
  SizeSystemEnumeration SkiResort SocialEvent SocialMediaPosting SoftwareApplication
  SoftwareSourceCode SolveMathAction SomeProducts SpeakableSpecification SpecialAnnouncement
  Specialty SportingGoodsStore SportsActivityLocation SportsClub SportsEvent SportsOrganization
  SportsTeam SpreadsheetDigitalDocument StadiumOrArena State Statement StatisticalPopulation
  StatisticalVariable StatusEnumeration SteeringPositionValue Store StructuredValue StupidType
  SubscribeAction Substance SubwayStation Suite SuperficialAnatomy SurgicalProcedure SuspendAction
  Syllabus Synagogue TVClip TVEpisode TVSeason TVSeries Table TakeAction TattooParlor Taxi
  TaxiReservation TaxiService TaxiStand Taxon TechArticle TelevisionChannel TelevisionStation
  TennisComplex TextDigitalDocument TextObject TheaterEvent TheaterGroup TherapeuticProcedure
  Thesis Thing Ticket TieAction TierBenefitEnumeration TipAction TireShop TouristAttraction
  TouristDestination TouristInformationCenter TouristTrip ToyStore TrackAction TradeAction
  TrainReservation TrainStation TrainTrip TransferAction TravelAction TravelAgency
  TreatmentIndication Trip TypeAndQuantityNode UKNonprofitType USNonprofitType UnRegisterAction
  UnitPriceSpecification UpdateAction UseAction UserBlocks UserCheckins UserComments UserDownloads
  UserInteraction UserLikes UserPageVisits UserPlays UserPlusOnes UserReview UserTweets
  VacationRental Vehicle Vein Vessel VeterinaryCare VideoGallery VideoGame VideoGameClip
  VideoGameSeries VideoObject VideoObjectSnapshot ViewAction VirtualLocation VisualArtsEvent
  VisualArtwork VitalSign Volcano VoteAction WPAdBlock WPFooter WPHeader WPSideBar WantAction
  WarrantyPromise WarrantyScope WatchAction Waterfall WearAction
  WearableMeasurementTypeEnumeration WearableSizeGroupEnumeration WearableSizeSystemEnumeration
  WebAPI WebApplication WebContent WebPage WebPageElement WebSite WholesaleStore WinAction Winery
  WorkBasedProgram WorkersUnion WriteAction Zoo
`.trim().split(/\s+/)
);

/** `Organization` y todos sus subtipos (186, `LocalBusiness` y los suyos incluidos). */
export const SUBTIPOS_DE_ORGANIZATION: ReadonlySet<string> = new Set(
  `
  AccountingService AdultEntertainment Airline AmusementPark AnimalShelter ArchiveOrganization
  ArtGallery Attorney AutoBodyShop AutoDealer AutoPartsStore AutoRental AutoRepair AutoWash
  AutomatedTeller AutomotiveBusiness Bakery BankOrCreditUnion BarOrPub BeautySalon BedAndBreakfast
  BikeStore BookStore BowlingAlley Brewery CafeOrCoffeeShop Campground Casino ChildCare
  ClothingStore CollegeOrUniversity ComedyClub CommunityHealth ComputerStore Consortium
  ConvenienceStore Cooperative Corporation CovidTestingFacility DanceGroup DaySpa Dentist
  DepartmentStore Dermatology DiagnosticLab DietNutrition Distillery DryCleaningOrLaundry
  EducationalOrganization Electrician ElectronicsStore ElementarySchool Emergency EmergencyService
  EmploymentAgency EntertainmentBusiness ExerciseGym FastFoodRestaurant FinancialService
  FireStation Florist FoodEstablishment FundingAgency FundingScheme FurnitureStore GardenStore
  GasStation GeneralContractor Geriatric GolfCourse GovernmentOffice GovernmentOrganization
  GroceryStore Gynecologic HVACBusiness HairSalon HardwareStore HealthAndBeautyBusiness HealthClub
  HighSchool HobbyShop HomeAndConstructionBusiness HomeGoodsStore Hospital Hostel Hotel
  HousePainter IceCreamShop IndividualPhysician InsuranceAgency InternetCafe JewelryStore
  LegalService Library LibrarySystem LiquorStore LocalBusiness Locksmith LodgingBusiness
  MedicalBusiness MedicalClinic MedicalOrganization MensClothingStore MiddleSchool Midwifery
  MobilePhoneStore Motel MotorcycleDealer MotorcycleRepair MovieRentalStore MovieTheater
  MovingCompany MusicGroup MusicStore NGO NailSalon NewsMediaOrganization NightClub Notary Nursing
  Obstetric OfficeEquipmentStore Oncologic OnlineBusiness OnlineMarketplace OnlineStore Optician
  Optometric Organization Otolaryngologic OutletStore PawnShop Pediatric PerformingGroup PetStore
  Pharmacy Physician PhysiciansOffice Physiotherapy PlasticSurgery Plumber Podiatric PoliceStation
  PoliticalParty PostOffice Preschool PrimaryCare ProfessionalService Project Psychiatric
  PublicHealth PublicSwimmingPool RadioStation RealEstateAgent RecyclingCenter
  ResearchOrganization ResearchProject Resort Restaurant RoofingContractor School
  SearchRescueOrganization SelfStorage ShoeStore ShoppingCenter SkiResort SportingGoodsStore
  SportsActivityLocation SportsClub SportsOrganization SportsTeam StadiumOrArena Store
  TattooParlor TelevisionStation TennisComplex TheaterGroup TireShop TouristInformationCenter
  ToyStore TravelAgency VacationRental VeterinaryCare WholesaleStore Winery WorkersUnion
`.trim().split(/\s+/)
);

/** `LocalBusiness` y todos sus subtipos (150): `Restaurant`, `Dentist`, `Plumber`… */
export const SUBTIPOS_DE_LOCAL_BUSINESS: ReadonlySet<string> = new Set(
  `
  AccountingService AdultEntertainment AmusementPark AnimalShelter ArchiveOrganization ArtGallery
  Attorney AutoBodyShop AutoDealer AutoPartsStore AutoRental AutoRepair AutoWash AutomatedTeller
  AutomotiveBusiness Bakery BankOrCreditUnion BarOrPub BeautySalon BedAndBreakfast BikeStore
  BookStore BowlingAlley Brewery CafeOrCoffeeShop Campground Casino ChildCare ClothingStore
  ComedyClub CommunityHealth ComputerStore ConvenienceStore CovidTestingFacility DaySpa Dentist
  DepartmentStore Dermatology DietNutrition Distillery DryCleaningOrLaundry Electrician
  ElectronicsStore Emergency EmergencyService EmploymentAgency EntertainmentBusiness ExerciseGym
  FastFoodRestaurant FinancialService FireStation Florist FoodEstablishment FurnitureStore
  GardenStore GasStation GeneralContractor Geriatric GolfCourse GovernmentOffice GroceryStore
  Gynecologic HVACBusiness HairSalon HardwareStore HealthAndBeautyBusiness HealthClub HobbyShop
  HomeAndConstructionBusiness HomeGoodsStore Hospital Hostel Hotel HousePainter IceCreamShop
  IndividualPhysician InsuranceAgency InternetCafe JewelryStore LegalService Library LiquorStore
  LocalBusiness Locksmith LodgingBusiness MedicalBusiness MedicalClinic MensClothingStore
  Midwifery MobilePhoneStore Motel MotorcycleDealer MotorcycleRepair MovieRentalStore MovieTheater
  MovingCompany MusicStore NailSalon NightClub Notary Nursing Obstetric OfficeEquipmentStore
  Oncologic Optician Optometric Otolaryngologic OutletStore PawnShop Pediatric PetStore Pharmacy
  Physician PhysiciansOffice Physiotherapy PlasticSurgery Plumber Podiatric PoliceStation
  PostOffice PrimaryCare ProfessionalService Psychiatric PublicHealth PublicSwimmingPool
  RadioStation RealEstateAgent RecyclingCenter Resort Restaurant RoofingContractor SelfStorage
  ShoeStore ShoppingCenter SkiResort SportingGoodsStore SportsActivityLocation SportsClub
  StadiumOrArena Store TattooParlor TelevisionStation TennisComplex TireShop
  TouristInformationCenter ToyStore TravelAgency VacationRental WholesaleStore Winery
`.trim().split(/\s+/)
);
