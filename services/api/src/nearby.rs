use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Diet {
    None,
    Vegetarian,
    Vegan,
    Jain,
    Pescatarian,
    Halal,
    Kosher,
}

impl Diet {
    fn needs_vegetarian(self) -> bool {
        matches!(self, Diet::Vegetarian | Diet::Vegan | Diet::Jain)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub id: String,
    pub name: String,
    pub address: String,
    pub maps_uri: String,
    pub lat: f64,
    pub lng: f64,
    pub distance_m: u32,
    pub rating: Option<f32>,
    pub price_level: Option<u8>,
    pub open_now: Option<bool>,
    pub serves_vegetarian: Option<bool>,
}

#[derive(Debug, Clone, Copy)]
pub struct Want {
    pub diet: Diet,
    pub max_price: Option<u8>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ranked {
    #[serde(flatten)]
    pub place: Place,
    pub why: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Results {
    pub places: Vec<Ranked>,
    pub relaxed: Vec<&'static str>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Food,
    Pharmacy,
    Atm,
    Sights,
}

impl Kind {
    fn types(self) -> &'static [&'static str] {
        match self {
            Kind::Food => &["restaurant", "cafe", "bakery"],
            Kind::Pharmacy => &["pharmacy"],
            Kind::Atm => &["atm"],
            Kind::Sights => &["tourist_attraction", "museum", "park"],
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub lat: f64,
    pub lng: f64,
    pub kind: Kind,
    pub diet: Option<Diet>,
    pub max_price: Option<u8>,
}

const RADIUS_M: f64 = 1500.0;
const FIELDS: &str = "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.priceLevel,places.currentOpeningHours.openNow,places.servesVegetarianFood,places.googleMapsUri";

/// Google Places (New). The key stays on the server.
pub async fn search(http: &reqwest::Client, key: &str, q: &Query) -> Result<Results> {
    if !(-90.0..=90.0).contains(&q.lat) || !(-180.0..=180.0).contains(&q.lng) {
        return Err(Error::Invalid("location out of range".into()));
    }
    let diet = q.diet.unwrap_or(Diet::None);
    let circle = json!({ "circle": { "center": { "latitude": q.lat, "longitude": q.lng }, "radius": RADIUS_M } });
    let text_query = match (q.kind, diet) {
        (Kind::Food, Diet::Halal) => Some("halal food"),
        (Kind::Food, Diet::Kosher) => Some("kosher food"),
        _ => None,
    };
    let (url, body) = match text_query {
        Some(t) => (
            "https://places.googleapis.com/v1/places:searchText",
            json!({ "textQuery": t, "locationBias": circle, "pageSize": 20 }),
        ),
        None => (
            "https://places.googleapis.com/v1/places:searchNearby",
            json!({ "includedTypes": q.kind.types(), "maxResultCount": 20, "locationRestriction": circle, "rankPreference": "DISTANCE" }),
        ),
    };
    let res = http
        .post(url)
        .header("X-Goog-Api-Key", key)
        .header("X-Goog-FieldMask", FIELDS)
        .json(&body)
        .send()
        .await?;
    let status = res.status();
    if !status.is_success() {
        return Err(Error::Upstream(format!("places {status}")));
    }
    let raw: Value = res.json().await?;
    let places = raw["places"]
        .as_array()
        .map(|ps| {
            ps.iter()
                .filter_map(|p| parse_place(p, q.lat, q.lng))
                .collect()
        })
        .unwrap_or_default();
    Ok(rank(
        places,
        Want {
            diet,
            max_price: q.max_price,
        },
    ))
}

fn parse_place(p: &Value, lat: f64, lng: f64) -> Option<Place> {
    let (plat, plng) = (
        p["location"]["latitude"].as_f64()?,
        p["location"]["longitude"].as_f64()?,
    );
    Some(Place {
        id: p["id"].as_str()?.to_string(),
        name: p["displayName"]["text"].as_str()?.to_string(),
        address: p["formattedAddress"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        maps_uri: p["googleMapsUri"].as_str().unwrap_or_default().to_string(),
        lat: plat,
        lng: plng,
        distance_m: distance_m(lat, lng, plat, plng),
        rating: p["rating"].as_f64().map(|r| r as f32),
        price_level: p["priceLevel"].as_str().and_then(price_level),
        open_now: p["currentOpeningHours"]["openNow"].as_bool(),
        serves_vegetarian: p["servesVegetarianFood"].as_bool(),
    })
}

fn price_level(raw: &str) -> Option<u8> {
    match raw {
        "PRICE_LEVEL_FREE" => Some(0),
        "PRICE_LEVEL_INEXPENSIVE" => Some(1),
        "PRICE_LEVEL_MODERATE" => Some(2),
        "PRICE_LEVEL_EXPENSIVE" => Some(3),
        "PRICE_LEVEL_VERY_EXPENSIVE" => Some(4),
        _ => None,
    }
}

fn distance_m(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> u32 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let (dp, dl) = ((lat2 - lat1).to_radians(), (lng2 - lng1).to_radians());
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    (6_371_000.0 * 2.0 * a.sqrt().asin()).round() as u32
}

/// Hard filters first (closed, over budget, not diet-safe); if that empties the list,
/// relax budget then diet and say so. Unknown facts never exclude a place.
pub fn rank(places: Vec<Place>, want: Want) -> Results {
    let places: Vec<Place> = places
        .into_iter()
        .filter(|p| p.open_now != Some(false))
        .collect();
    let steps: [(&[&'static str], Want); 3] = [
        (&[], want),
        (
            &["budget"],
            Want {
                max_price: None,
                ..want
            },
        ),
        (
            &["budget", "diet"],
            Want {
                max_price: None,
                diet: Diet::None,
            },
        ),
    ];
    for (relaxed, w) in steps {
        let mut kept: Vec<(f32, Place)> = places
            .iter()
            .filter(|p| fits(p, w))
            .map(|p| (score(p, want), p.clone()))
            .collect();
        if kept.is_empty() {
            continue;
        }
        kept.sort_by(|a, b| b.0.total_cmp(&a.0));
        let places = kept
            .into_iter()
            .map(|(_, p)| Ranked {
                why: why(&p, want),
                place: p,
            })
            .collect();
        return Results {
            places,
            relaxed: relaxed.to_vec(),
        };
    }
    Results {
        places: Vec::new(),
        relaxed: Vec::new(),
    }
}

fn fits(p: &Place, w: Want) -> bool {
    let affordable = match (w.max_price, p.price_level) {
        (Some(max), Some(level)) => level <= max,
        _ => true,
    };
    let diet_safe = !(w.diet.needs_vegetarian() && p.serves_vegetarian == Some(false));
    affordable && diet_safe
}

fn score(p: &Place, want: Want) -> f32 {
    let mut s = p.rating.unwrap_or(3.5) * 20.0 - p.distance_m as f32 / 50.0;
    if want.diet.needs_vegetarian() && p.serves_vegetarian == Some(true) {
        s += 15.0;
    }
    if p.open_now.is_none() {
        s -= 5.0;
    }
    if want.max_price.is_some() && p.price_level.is_none() {
        s -= 5.0;
    }
    s
}

fn why(p: &Place, want: Want) -> String {
    let mut parts = Vec::new();
    if want.diet.needs_vegetarian() && p.serves_vegetarian == Some(true) {
        parts.push("Vegetarian options".to_string());
    }
    if let Some(level) = p.price_level.filter(|l| *l > 0) {
        parts.push("$".repeat(level as usize));
    }
    if let Some(r) = p.rating {
        parts.push(format!("{r:.1}★"));
    }
    parts.push(if p.distance_m < 1000 {
        format!("{} m", p.distance_m)
    } else {
        format!("{:.1} km", p.distance_m as f32 / 1000.0)
    });
    parts.join(" · ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn place(id: &str) -> Place {
        Place {
            id: id.into(),
            name: id.into(),
            address: String::new(),
            maps_uri: String::new(),
            lat: 0.0,
            lng: 0.0,
            distance_m: 300,
            rating: Some(4.2),
            price_level: Some(2),
            open_now: Some(true),
            serves_vegetarian: None,
        }
    }

    fn ids(r: &Results) -> Vec<&str> {
        r.places.iter().map(|p| p.place.id.as_str()).collect()
    }

    const ANY: Want = Want {
        diet: Diet::None,
        max_price: None,
    };

    #[test]
    fn drops_places_known_to_be_closed() {
        let closed = Place {
            open_now: Some(false),
            ..place("closed")
        };
        let unknown = Place {
            open_now: None,
            ..place("unknown")
        };
        let r = rank(vec![closed, unknown, place("open")], ANY);
        assert_eq!(ids(&r), ["open", "unknown"]);
    }

    #[test]
    fn drops_places_over_budget_but_keeps_unknown_price() {
        let pricey = Place {
            price_level: Some(4),
            ..place("pricey")
        };
        let unpriced = Place {
            price_level: None,
            ..place("unpriced")
        };
        let r = rank(
            vec![pricey, unpriced, place("cheap")],
            Want {
                diet: Diet::None,
                max_price: Some(2),
            },
        );
        assert_eq!(ids(&r), ["cheap", "unpriced"]);
        assert!(r.relaxed.is_empty());
    }

    #[test]
    fn vegetarian_diets_exclude_known_non_vegetarian_and_prefer_confirmed() {
        let steak = Place {
            serves_vegetarian: Some(false),
            ..place("steak")
        };
        let veg = Place {
            serves_vegetarian: Some(true),
            distance_m: 900,
            ..place("veg")
        };
        let r = rank(
            vec![steak, place("maybe"), veg],
            Want {
                diet: Diet::Vegan,
                max_price: None,
            },
        );
        assert_eq!(ids(&r), ["veg", "maybe"]);
    }

    #[test]
    fn closer_and_better_rated_rank_higher() {
        let far = Place {
            distance_m: 2000,
            ..place("far")
        };
        let great = Place {
            rating: Some(4.9),
            ..place("great")
        };
        let r = rank(vec![far, place("near"), great], ANY);
        assert_eq!(ids(&r), ["great", "near", "far"]);
    }

    #[test]
    fn relaxes_budget_then_diet_when_nothing_matches() {
        let pricey = Place {
            price_level: Some(4),
            serves_vegetarian: Some(false),
            ..place("pricey")
        };
        let r = rank(
            vec![pricey],
            Want {
                diet: Diet::Vegetarian,
                max_price: Some(1),
            },
        );
        assert_eq!(ids(&r), ["pricey"]);
        assert_eq!(r.relaxed, ["budget", "diet"]);
    }

    #[test]
    fn explains_the_match_from_facts_only() {
        let p = Place {
            serves_vegetarian: Some(true),
            price_level: Some(2),
            rating: Some(4.5),
            distance_m: 400,
            ..place("p")
        };
        let r = rank(
            vec![p],
            Want {
                diet: Diet::Vegetarian,
                max_price: None,
            },
        );
        assert_eq!(r.places[0].why, "Vegetarian options · $$ · 4.5★ · 400 m");

        let bare = Place {
            rating: None,
            price_level: None,
            distance_m: 1500,
            ..place("bare")
        };
        assert_eq!(rank(vec![bare], ANY).places[0].why, "1.5 km");
    }

    #[test]
    fn parses_places_api_shape() {
        let raw = json!({
            "id": "abc", "displayName": { "text": "Veggie Hut" }, "formattedAddress": "1 Soi Rambuttri",
            "location": { "latitude": 13.7563, "longitude": 100.5018 }, "rating": 4.6,
            "priceLevel": "PRICE_LEVEL_MODERATE", "currentOpeningHours": { "openNow": true },
            "servesVegetarianFood": true, "googleMapsUri": "https://maps.google.com/?cid=1"
        });
        let p = parse_place(&raw, 13.7563, 100.4928).unwrap();
        assert_eq!(
            (
                p.name.as_str(),
                p.price_level,
                p.open_now,
                p.serves_vegetarian
            ),
            ("Veggie Hut", Some(2), Some(true), Some(true))
        );
        assert!(
            (970..=980).contains(&p.distance_m),
            "distance {}",
            p.distance_m
        );
        assert!(parse_place(&json!({ "id": "x" }), 0.0, 0.0).is_none());
    }

    #[test]
    fn empty_input_is_empty_output() {
        let r = rank(vec![], ANY);
        assert!(r.places.is_empty() && r.relaxed.is_empty());
    }
}
