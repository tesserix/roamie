// Generated from Rust trips.rs; run cargo test export_mobile_contract.
export type Destination = { placeId: string, name: string, label: string, countryCode: string, country: string, latitude?: number, longitude?: number, };
export type PlanningPreferences = { styles: string[], adults: number, children: number, luggage: number, foodPreferences: string[], };
export type TripStay = { destination: Destination, days: number, };
export type PlanRequest = { title: string, destination: string, startDate: string, endDate: string, currency: string, budgetMinor: number, diet: string, interests: string, travellers: number, preferences?: PlanningPreferences, stays?: TripStay[], };
export type TripPlace = { id: string, name: string, address: string, mapsUri: string, lat: number, lng: number, };
export type TravelMode = "taxi" | "bicycle" | "rentalCar" | "publicTransport" | "walk";
export type Transport = { mode: TravelMode, minutes: number, costMinor: number, note: string, };
export type TripStop = { id: string, time: string, minutes: number, kind: string, title: string, note: string, costMinor: number, place: TripPlace | null, transport: Transport[], };
export type TripDay = { date: string, destination?: string, stops: TripStop[], };
export type PlanResponse = { days: TripDay[], notice: string, };
export const TRIP_STYLES = ["Relaxed","Adventure","Culture","Nature","Beach","Food","Nightlife","Clubbing","Party","Family","Step-free"] as const;
export const FOOD_PREFERENCES = ["Vegetarian","Vegan","Jain","Pescatarian","Halal","Kosher","Buddhist vegetarian","No beef","No pork","Dairy-free","Gluten-free","Low-FODMAP"] as const;
