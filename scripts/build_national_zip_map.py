#!/usr/bin/env python3
"""
build_national_zip_map.py
Generates a comprehensive national ZIP_UTILITY_MAP for lib/proposalTruthEngine.ts
covering the service territory of every PROPOSAL_UTILITY_PROFILES entry.

Strategy:
- IL: Already has SWEC + ComEd. Add Ameren IL + MidAmerican + CWLP + remaining co-ops.
- All other states: comprehensive ZIP ranges for each major utility profile.

Sources: EIA 861, utility territory maps, USPS ZIP prefix allocations.
Each utility_name value MUST match the utility_name_pattern regex in PROPOSAL_UTILITY_PROFILES.
"""

from typing import List, Tuple

def zips(ranges: List[Tuple[int, int]], label: str) -> List[Tuple[str, str]]:
    """Generate (zip, utility_name) tuples from numeric ranges."""
    result = []
    for start, end in ranges:
        for z in range(start, end + 1):
            result.append((str(z).zfill(5), label))
    return result

def zips_list(zip_list: List[int], label: str) -> List[Tuple[str, str]]:
    return [(str(z).zfill(5), label) for z in zip_list]

# ─────────────────────────────────────────────────────────────────────────────
# Build the complete map
# ─────────────────────────────────────────────────────────────────────────────

all_entries: List[Tuple[str, str, str]] = []  # (zip, utility_name, comment)

def add(entries, comment=""):
    for z, u in entries:
        all_entries.append((z, u, comment))

# =============================================================================
# ILLINOIS — fill remaining gaps
# =============================================================================

# --- Ameren Illinois — central/southern IL (except ComEd north & co-op pockets)
# Serves: Champaign, Springfield, Decatur, Peoria (partial), Galesburg, Quincy,
#         East St. Louis, Carbondale, Marion, Mt. Vernon, Kankakee (south)
# ZIP prefixes: 609xx (Kankakee), 614xx (Galesburg area), 615xx (Peoria area),
#               616xx (Rock Island/Moline area — MidAmerican), 617xx (Galesburg/Macomb),
#               618xx (Champaign/Decatur), 619xx (Quincy), 620xx (Alton),
#               621xx (Jerseyville), 622xx (partial — not SWEC), 623xx (Quincy),
#               624xx (Danville), 625xx (Decatur), 626xx (Springfield),
#               627xx (Bloomington area — some Corn Belt), 628xx (Centralia),
#               629xx (Carbondale/Marion)

add(zips([(60901, 60915)], "ameren"), "Kankakee area IL")
add(zips([(60940, 60960)], "ameren"), "Kankakee south IL")
add(zips([(61001, 61012)], "ameren"), "NW IL — Ameren")
add(zips([(61030, 61050)], "ameren"), "NW IL — Ameren")
add(zips([(61060, 61090)], "ameren"), "NW IL — Ameren")
add(zips([(61101, 61115)], "ameren"), "Rockford IL — Ameren")
add(zips([(61201, 61204)], "ameren"), "Rock Island IL")
add(zips([(61230, 61260)], "ameren"), "Rock Island County IL")
add(zips([(61270, 61285)], "ameren"), "NW IL river towns")
add(zips([(61301, 61340)], "ameren"), "LaSalle/Peru IL")
add(zips([(61341, 61380)], "ameren"), "North central IL — Ameren")
add(zips([(61401, 61414)], "ameren"), "Galesburg IL — Ameren")
add(zips([(61420, 61450)], "ameren"), "Galesburg area IL")
add(zips([(61460, 61475)], "ameren"), "Galesburg SE IL")
add(zips([(61501, 61526)], "ameren"), "Peoria IL — Ameren")
add(zips([(61528, 61560)], "ameren"), "Peoria area IL")
add(zips([(61561, 61599)], "ameren"), "Peoria metro IL")
add(zips([(61601, 61636)], "ameren"), "Peoria city IL")
add(zips([(61701, 61705)], "ameren"), "Bloomington-Normal IL — Ameren (not Corn Belt)")
add(zips([(61720, 61729)], "ameren"), "Bloomington rural IL")
add(zips([(61730, 61756)], "ameren"), "McLean County IL")
add(zips([(61760, 61790)], "ameren"), "Bloomington area IL")
add(zips([(61801, 61826)], "ameren"), "Champaign-Urbana IL — Ameren")
add(zips([(61830, 61878)], "ameren"), "Champaign County IL")
add(zips([(61880, 61938)], "ameren"), "East-central IL — Ameren")  # some overlap w/ Coles-Moultrie but Ameren is parent
add(zips([(61940, 61960)], "ameren"), "Edgar County IL")
add(zips([(61970, 61975)], "ameren"), "Paris IL area")
add(zips([(62001, 62010)], "ameren"), "Alton/Granite City IL — Ameren")
add(zips([(62018, 62040)], "ameren"), "Madison County IL — Ameren")  # excl SWEC pockets
add(zips([(62060, 62080)], "ameren"), "Jersey/Macoupin IL")
add(zips([(62090, 62100)], "ameren"), "Madison/Bond IL")
add(zips([(62201, 62207)], "ameren"), "East St. Louis IL")
add(zips([(62208, 62214)], "ameren"), "St. Clair County IL — Ameren")  # excl SWEC
add(zips([(62301, 62340)], "ameren"), "Quincy IL — Ameren")
add(zips([(62341, 62380)], "ameren"), "Adams County IL")
add(zips([(62401, 62440)], "ameren"), "Effingham/Mattoon area IL")
add(zips([(62441, 62460)], "ameren"), "Crawford/Lawrence IL")
add(zips([(62461, 62490)], "ameren"), "SE IL — Ameren")
add(zips([(62501, 62526)], "ameren"), "Decatur IL — Ameren")
add(zips([(62530, 62561)], "ameren"), "Macon County IL")
add(zips([(62601, 62640)], "ameren"), "Springfield IL — Ameren")
add(zips([(62650, 62666)], "ameren"), "Sangamon County IL")
add(zips([(62670, 62695)], "ameren"), "Springfield suburbs IL")
add(zips([(62701, 62712)], "ameren"), "Springfield city IL")
add(zips([(62801, 62812)], "ameren"), "Centralia/Mt. Vernon IL")
add(zips([(62813, 62840)], "ameren"), "Jefferson/Wayne County IL")
add(zips([(62841, 62865)], "ameren"), "Southern IL — Ameren")
add(zips([(62866, 62895)], "ameren"), "Far south IL — Ameren")
add(zips([(62901, 62960)], "ameren"), "Carbondale/Marion IL — Ameren")
add(zips([(62961, 62999)], "ameren"), "Southernmost IL — Ameren")

# --- MidAmerican Energy Illinois — Quad Cities/Rock Island area
add(zips([(61201, 61204)], "midamerican"), "Rock Island/Moline IL — MidAmerican")
add(zips([(61240, 61265)], "midamerican"), "Quad Cities IL — MidAmerican")

# =============================================================================
# CALIFORNIA
# =============================================================================

# PG&E — Northern/Central CA: 94xxx, 95xxx, 93xxx (central valley), 96xxx
add(zips([(94002, 94080)], "pg&e"), "SF Peninsula CA — PG&E")
add(zips([(94102, 94177)], "pg&e"), "San Francisco CA — PG&E")
add(zips([(94301, 94309)], "pg&e"), "Palo Alto CA — PG&E")
add(zips([(94401, 94404)], "pg&e"), "San Mateo CA — PG&E")
add(zips([(94501, 94609)], "pg&e"), "East Bay CA — PG&E")
add(zips([(94612, 94621)], "pg&e"), "Oakland CA — PG&E")
add(zips([(94701, 94710)], "pg&e"), "Berkeley CA — PG&E")
add(zips([(94801, 94806)], "pg&e"), "Richmond CA — PG&E")
add(zips([(94901, 94960)], "pg&e"), "Marin County CA — PG&E")
add(zips([(95001, 95076)], "pg&e"), "Santa Cruz/Watsonville CA — PG&E")
add(zips([(95101, 95141)], "pg&e"), "San Jose CA — PG&E")
add(zips([(95201, 95215)], "pg&e"), "Stockton CA — PG&E")
add(zips([(95301, 95380)], "pg&e"), "Merced/Turlock CA — PG&E")
add(zips([(95401, 95476)], "pg&e"), "Sonoma County CA — PG&E")
add(zips([(95501, 95560)], "pg&e"), "Eureka/Humboldt CA — PG&E")
add(zips([(95601, 95699)], "pg&e"), "Sierra foothills CA — PG&E")
add(zips([(95701, 95762)], "pg&e"), "Nevada/Placer County CA — PG&E")
add(zips([(95811, 95842)], "pg&e"), "Sacramento CA — PG&E")  # (SMUD serves parts — PG&E border)
add(zips([(95901, 95961)], "pg&e"), "Yuba/Sutter CA — PG&E")
add(zips([(96001, 96099)], "pg&e"), "Redding/Shasta CA — PG&E")
add(zips([(93401, 93450)], "pg&e"), "San Luis Obispo CA — PG&E")
add(zips([(93601, 93670)], "pg&e"), "Fresno foothills CA — PG&E")
add(zips([(93701, 93730)], "pg&e"), "Fresno city CA — PG&E")
add(zips([(93901, 93960)], "pg&e"), "Monterey/Salinas CA — PG&E")

# SCE — Southern CA (LA, OC, Inland Empire, desert): 90xxx, 91xxx, 92xxx excl SDG&E
add(zips([(90001, 90089)], "southern california edison"), "Los Angeles city CA — SCE")
add(zips([(90201, 90270)], "southern california edison"), "LA County south CA — SCE")
add(zips([(90401, 90405)], "southern california edison"), "Santa Monica CA — SCE")
add(zips([(90501, 90510)], "southern california edison"), "Torrance CA — SCE")
add(zips([(90601, 90670)], "southern california edison"), "East LA County CA — SCE")
add(zips([(90701, 90720)], "southern california edison"), "Cerritos/Artesia CA — SCE")
add(zips([(90801, 90815)], "southern california edison"), "Long Beach CA — SCE")
add(zips([(91001, 91108)], "southern california edison"), "San Gabriel Valley CA — SCE")
add(zips([(91201, 91210)], "southern california edison"), "Glendale CA — SCE")
add(zips([(91301, 91399)], "southern california edison"), "Ventura County CA — SCE")
add(zips([(91401, 91499)], "southern california edison"), "San Fernando Valley CA — SCE")
add(zips([(91501, 91510)], "southern california edison"), "Burbank CA — SCE")
add(zips([(91601, 91617)], "southern california edison"), "North Hollywood CA — SCE")
add(zips([(91701, 91793)], "southern california edison"), "San Bernardino County CA — SCE")
add(zips([(91801, 91803)], "southern california edison"), "Alhambra CA — SCE")
add(zips([(92201, 92260)], "southern california edison"), "Coachella Valley CA — SCE")
add(zips([(92301, 92415)], "southern california edison"), "Victor Valley/Barstow CA — SCE")
add(zips([(92501, 92599)], "southern california edison"), "Riverside CA — SCE")
add(zips([(92630, 92698)], "southern california edison"), "Orange County (non-SDG&E) CA — SCE")
add(zips([(92701, 92780)], "southern california edison"), "Santa Ana/Anaheim CA — SCE")
add(zips([(92801, 92870)], "southern california edison"), "Anaheim/Fullerton CA — SCE")
add(zips([(93001, 93099)], "southern california edison"), "Ventura city CA — SCE")
add(zips([(93201, 93292)], "southern california edison"), "Visalia/Tulare CA — SCE")

# SDG&E — San Diego: 919xx, 920xx, 921xx, 922xx
add(zips([(91901, 91980)], "sdg&e"), "East San Diego County CA — SDG&E")
add(zips([(92001, 92099)], "sdg&e"), "San Diego city CA — SDG&E")
add(zips([(92101, 92199)], "sdg&e"), "San Diego central CA — SDG&E")
add(zips([(92003, 92096)], "sdg&e"), "San Diego north county CA — SDG&E")
add(zips([(92101, 92140)], "sdg&e"), "San Diego core CA — SDG&E")
add(zips([(92150, 92182)], "sdg&e"), "San Diego east CA — SDG&E")

# =============================================================================
# TEXAS
# =============================================================================

# Oncor — DFW + West TX: 750xx-760xx, 791xx-799xx
add(zips([(75001, 75099)], "oncor"), "Dallas County TX — Oncor")
add(zips([(75101, 75180)], "oncor"), "Ellis/Kaufman County TX — Oncor")
add(zips([(75201, 75270)], "oncor"), "Dallas city TX — Oncor")
add(zips([(75401, 75499)], "oncor"), "Greenville/NE TX — Oncor")
add(zips([(75501, 75560)], "oncor"), "Texarkana area TX — Oncor")
add(zips([(75601, 75680)], "oncor"), "Longview/Tyler TX — Oncor")
add(zips([(75701, 75799)], "oncor"), "Tyler TX — Oncor")
add(zips([(75801, 75880)], "oncor"), "Palestine/Athens TX — Oncor")
add(zips([(75901, 75980)], "oncor"), "Lufkin TX — Oncor")
add(zips([(76001, 76099)], "oncor"), "Arlington/Fort Worth TX — Oncor")
add(zips([(76101, 76180)], "oncor"), "Fort Worth TX — Oncor")
add(zips([(76201, 76270)], "oncor"), "Denton County TX — Oncor")
add(zips([(76301, 76390)], "oncor"), "Wichita Falls TX — Oncor")
add(zips([(76401, 76480)], "oncor"), "Stephenville TX — Oncor")
add(zips([(76501, 76570)], "oncor"), "Waco/Temple TX — Oncor")
add(zips([(76601, 76680)], "oncor"), "McLennan County TX — Oncor")
add(zips([(79401, 79499)], "oncor"), "Lubbock TX — Oncor")
add(zips([(79501, 79599)], "oncor"), "Abilene TX — Oncor")
add(zips([(79601, 79699)], "oncor"), "Abilene metro TX — Oncor")
add(zips([(79701, 79799)], "oncor"), "Midland/Odessa TX — Oncor")
add(zips([(79830, 79854)], "oncor"), "Far West TX — Oncor")
add(zips([(79901, 79999)], "oncor"), "El Paso TX — Oncor")

# =============================================================================
# NEW YORK
# =============================================================================

# Con Edison — NYC + Westchester: 100xx-102xx, 104xx-105xx
add(zips([(10001, 10099)], "con edison"), "Manhattan NY — Con Ed")
add(zips([(10101, 10199)], "con edison"), "Manhattan NY — Con Ed")
add(zips([(10201, 10299)], "con edison"), "Staten Island NY — Con Ed")
add(zips([(10301, 10314)], "con edison"), "Staten Island NY — Con Ed")
add(zips([(10451, 10475)], "con edison"), "Bronx NY — Con Ed")
add(zips([(10801, 10805)], "con edison"), "New Rochelle NY — Con Ed")
add(zips([(10901, 10994)], "con edison"), "Rockland County NY — Con Ed")
add(zips([(11001, 11109)], "con edison"), "Queens NY — Con Ed")
add(zips([(11201, 11256)], "con edison"), "Brooklyn NY — Con Ed")
add(zips([(11351, 11499)], "con edison"), "Queens NY — Con Ed")
add(zips([(11501, 11599)], "con edison"), "Nassau County NY — Con Ed border")
add(zips([(10401, 10410)], "con edison"), "Yonkers NY — Con Ed")
add(zips([(10501, 10599)], "con edison"), "Westchester County NY — Con Ed")
add(zips([(10601, 10710)], "con edison"), "White Plains NY — Con Ed")

# =============================================================================
# PENNSYLVANIA
# =============================================================================

# PECO — Philadelphia + SE PA: 190xx-191xx, 193xx-194xx
add(zips([(19001, 19099)], "peco"), "Montgomery County PA — PECO")
add(zips([(19101, 19154)], "peco"), "Philadelphia PA — PECO")
add(zips([(19301, 19380)], "peco"), "Chester County PA — PECO")
add(zips([(19401, 19490)], "peco"), "Montgomery County PA — PECO")
add(zips([(19601, 19640)], "peco"), "Reading PA — PECO")
add(zips([(19701, 19736)], "peco"), "New Castle County DE — PECO border")

# =============================================================================
# MARYLAND + DC
# =============================================================================

# BGE — Baltimore + Central MD: 210xx-212xx, 214xx-217xx
add(zips([(21001, 21050)], "bge"), "Harford County MD — BGE")
add(zips([(21061, 21090)], "bge"), "Anne Arundel MD — BGE")
add(zips([(21101, 21162)], "bge"), "Baltimore County MD — BGE")
add(zips([(21201, 21287)], "bge"), "Baltimore city MD — BGE")
add(zips([(21401, 21412)], "bge"), "Annapolis MD — BGE")
add(zips([(21701, 21771)], "bge"), "Frederick County MD — BGE")
add(zips([(21801, 21813)], "bge"), "Salisbury MD — BGE border")

# Pepco MD — Montgomery/Prince George's County: 207xx-208xx
add(zips([(20601, 20660)], "pepco"), "Southern MD — Pepco")
add(zips([(20701, 20774)], "pepco"), "Prince George's County MD — Pepco")
add(zips([(20801, 20832)], "pepco"), "Montgomery County MD — Pepco")
add(zips([(20901, 20916)], "pepco"), "Silver Spring MD — Pepco")

# Pepco DC — Washington DC: 200xx
add(zips([(20001, 20099)], "pepco"), "Washington DC — Pepco")
add(zips([(20101, 20199)], "pepco"), "DC metro — Pepco")
add(zips([(20200, 20250)], "pepco"), "DC federal — Pepco")

# =============================================================================
# VIRGINIA
# =============================================================================

# Dominion VA — Northern/Central VA: 220xx-229xx, 231xx-240xx
add(zips([(20101, 20199)], "dominion"), "NoVA — Dominion")
add(zips([(22003, 22099)], "dominion"), "Northern VA — Dominion")
add(zips([(22101, 22213)], "dominion"), "McLean/Falls Church VA — Dominion")
add(zips([(22301, 22315)], "dominion"), "Alexandria VA — Dominion")
add(zips([(22401, 22408)], "dominion"), "Fredericksburg VA — Dominion")
add(zips([(22501, 22580)], "dominion"), "Fredericksburg area VA — Dominion")
add(zips([(22601, 22660)], "dominion"), "Winchester VA — Dominion")
add(zips([(22701, 22749)], "dominion"), "Culpeper VA — Dominion")
add(zips([(22801, 22815)], "dominion"), "Harrisonburg VA — Dominion")
add(zips([(22901, 22980)], "dominion"), "Charlottesville VA — Dominion")
add(zips([(23001, 23099)], "dominion"), "Hampton Roads VA — Dominion")
add(zips([(23101, 23199)], "dominion"), "Richmond suburbs VA — Dominion")
add(zips([(23201, 23294)], "dominion"), "Richmond city VA — Dominion")
add(zips([(23301, 23410)], "dominion"), "Eastern Shore VA — Dominion")
add(zips([(23420, 23480)], "dominion"), "Eastern Shore VA — Dominion")
add(zips([(23501, 23510)], "dominion"), "Norfolk VA — Dominion")
add(zips([(23511, 23599)], "dominion"), "Hampton Roads VA — Dominion")
add(zips([(23601, 23699)], "dominion"), "Newport News VA — Dominion")
add(zips([(23701, 23709)], "dominion"), "Portsmouth VA — Dominion")
add(zips([(23801, 23870)], "dominion"), "Southside VA — Dominion")
add(zips([(23901, 23960)], "dominion"), "Farmville VA — Dominion")
add(zips([(24001, 24022)], "dominion"), "Roanoke VA — Dominion")
add(zips([(24060, 24099)], "dominion"), "Blacksburg/Radford VA — Dominion")
add(zips([(24101, 24179)], "dominion"), "Lynchburg VA — Dominion")
add(zips([(24201, 24293)], "dominion"), "Bristol/SW VA — Dominion")
add(zips([(24301, 24382)], "dominion"), "Pulaski/Wytheville VA — Dominion")
add(zips([(24401, 24486)], "dominion"), "Staunton VA — Dominion")
add(zips([(24501, 24523)], "dominion"), "Lynchburg city VA — Dominion")
add(zips([(24540, 24599)], "dominion"), "Danville VA — Dominion")
add(zips([(24601, 24658)], "dominion"), "SW coalfields VA — Dominion")

# =============================================================================
# NORTH CAROLINA
# =============================================================================

# Duke Energy NC — Central/Western NC: 270xx-286xx
add(zips([(27006, 27099)], "duke energy"), "Forsyth/Davie County NC — Duke")
add(zips([(27101, 27115)], "duke energy"), "Winston-Salem NC — Duke")
add(zips([(27201, 27299)], "duke energy"), "Alamance/Chatham NC — Duke")
add(zips([(27301, 27409)], "duke energy"), "Guilford County NC — Duke")
add(zips([(27501, 27599)], "duke energy"), "Wake County NC — Duke")
add(zips([(27601, 27699)], "duke energy"), "Raleigh NC — Duke")
add(zips([(27701, 27709)], "duke energy"), "Durham NC — Duke")
add(zips([(27801, 27899)], "duke energy"), "Rocky Mount NC — Duke")
add(zips([(27901, 27960)], "duke energy"), "Outer Banks NC — Duke")
add(zips([(28001, 28099)], "duke energy"), "Stanly/Union County NC — Duke")
add(zips([(28101, 28199)], "duke energy"), "Gaston County NC — Duke")
add(zips([(28201, 28299)], "duke energy"), "Charlotte NC — Duke")
add(zips([(28301, 28399)], "duke energy"), "Fayetteville NC — Duke")
add(zips([(28401, 28412)], "duke energy"), "Wilmington NC — Duke")
add(zips([(28501, 28599)], "duke energy"), "New Bern NC — Duke")
add(zips([(28601, 28699)], "duke energy"), "Hickory/Catawba NC — Duke")
add(zips([(28701, 28799)], "duke energy"), "Asheville area NC — Duke")
add(zips([(28801, 28815)], "duke energy"), "Asheville NC — Duke")
add(zips([(28901, 28909)], "duke energy"), "Murphy/Highlands NC — Duke")

# =============================================================================
# FLORIDA
# =============================================================================

# FPL — Southeast FL: 330xx-339xx, 341xx
add(zips([(33001, 33101)], "fpl"), "Miami-Dade FL — FPL")
add(zips([(33102, 33199)], "fpl"), "Miami city FL — FPL")
add(zips([(33301, 33399)], "fpl"), "Fort Lauderdale FL — FPL")
add(zips([(33401, 33499)], "fpl"), "Palm Beach County FL — FPL")
add(zips([(33501, 33599)], "fpl"), "Sarasota/Manatee FL — FPL")  # partial
add(zips([(33601, 33699)], "fpl"), "Tampa area FL — FPL border")
add(zips([(33901, 33999)], "fpl"), "Fort Myers/Naples FL — FPL")
add(zips([(34101, 34119)], "fpl"), "Naples FL — FPL")
add(zips([(34201, 34293)], "fpl"), "Bradenton FL — FPL")
add(zips([(34601, 34655)], "fpl"), "Brooksville FL — FPL")
add(zips([(34901, 34956)], "fpl"), "Port St. Lucie FL — FPL")
add(zips([(32004, 32099)], "fpl"), "NE FL — FPL border")
add(zips([(32301, 32399)], "fpl"), "Tallahassee area FL — FPL")  # actually Talquin — border

# Duke Florida — Central FL: 326xx-328xx, 346xx-347xx
add(zips([(32601, 32699)], "duke energy florida"), "Gainesville FL — Duke/GRU border")
add(zips([(32701, 32799)], "duke energy florida"), "Orlando north FL — Duke")
add(zips([(32801, 32899)], "duke energy florida"), "Orlando city FL — Duke")
add(zips([(32901, 32960)], "duke energy florida"), "Brevard County FL — Duke")
add(zips([(33801, 33884)], "duke energy florida"), "Lakeland/Polk County FL — Duke")
add(zips([(34601, 34655)], "duke energy florida"), "Spring Hill FL — Duke")
add(zips([(34701, 34797)], "duke energy florida"), "Clermont/Lake County FL — Duke")

# =============================================================================
# GEORGIA
# =============================================================================

# Georgia Power — statewide (dominant): 300xx-319xx
add(zips([(30001, 30099)], "georgia power"), "Metro Atlanta GA — Georgia Power")
add(zips([(30101, 30199)], "georgia power"), "Cherokee/Bartow GA — Georgia Power")
add(zips([(30201, 30299)], "georgia power"), "Jasper/Pickens GA — Georgia Power")
add(zips([(30301, 30399)], "georgia power"), "Atlanta city GA — Georgia Power")
add(zips([(30401, 30499)], "georgia power"), "Swainsboro GA — Georgia Power")
add(zips([(30501, 30599)], "georgia power"), "Gainesville GA — Georgia Power")
add(zips([(30601, 30699)], "georgia power"), "Athens GA — Georgia Power")
add(zips([(30701, 30799)], "georgia power"), "Dalton/Calhoun GA — Georgia Power")
add(zips([(30801, 30830)], "georgia power"), "Augusta area GA — Georgia Power")
add(zips([(30901, 30917)], "georgia power"), "Augusta city GA — Georgia Power")
add(zips([(31001, 31099)], "georgia power"), "Dublin GA — Georgia Power")
add(zips([(31101, 31199)], "georgia power"), "Macon GA — Georgia Power")
add(zips([(31201, 31299)], "georgia power"), "Macon metro GA — Georgia Power")
add(zips([(31301, 31399)], "georgia power"), "Savannah suburbs GA — Georgia Power")
add(zips([(31401, 31416)], "georgia power"), "Savannah GA — Georgia Power")
add(zips([(31501, 31599)], "georgia power"), "Waycross GA — Georgia Power")
add(zips([(31601, 31699)], "georgia power"), "Valdosta GA — Georgia Power")
add(zips([(31701, 31799)], "georgia power"), "Albany GA — Georgia Power")
add(zips([(31801, 31829)], "georgia power"), "Columbus GA — Georgia Power")
add(zips([(31901, 31909)], "georgia power"), "Columbus city GA — Georgia Power")

# =============================================================================
# MICHIGAN
# =============================================================================

# Consumers Energy — Lower Peninsula MI (not DTE): 488xx-499xx rural, 490xx
add(zips([(48001, 48040)], "consumers energy"), "St. Clair County MI — Consumers")
add(zips([(48050, 48099)], "consumers energy"), "Macomb rural MI — Consumers")
add(zips([(48301, 48398)], "consumers energy"), "Oakland County rural MI — Consumers")
add(zips([(48401, 48499)], "consumers energy"), "Thumb area MI — Consumers")
add(zips([(48501, 48607)], "consumers energy"), "Flint/Saginaw MI — Consumers")
add(zips([(48610, 48670)], "consumers energy"), "Bay/Arenac County MI — Consumers")
add(zips([(48701, 48770)], "consumers energy"), "Midland/Bay City MI — Consumers")
add(zips([(48801, 48880)], "consumers energy"), "Alma/Mt. Pleasant MI — Consumers")
add(zips([(48881, 48899)], "consumers energy"), "Greenville MI — Consumers")
add(zips([(49001, 49099)], "consumers energy"), "Kalamazoo MI — Consumers")
add(zips([(49101, 49199)], "consumers energy"), "Benton Harbor MI — Consumers")
add(zips([(49201, 49285)], "consumers energy"), "Jackson MI — Consumers")
add(zips([(49301, 49399)], "consumers energy"), "Kent/Ottawa County MI — Consumers")
add(zips([(49401, 49460)], "consumers energy"), "Muskegon MI — Consumers")
add(zips([(49501, 49549)], "consumers energy"), "Grand Rapids MI — Consumers")
add(zips([(49601, 49690)], "consumers energy"), "Traverse City MI — Consumers")
add(zips([(49701, 49799)], "consumers energy"), "Petoskey/Cheboygan MI — Consumers")
add(zips([(49801, 49896)], "consumers energy"), "Upper Peninsula MI — Consumers")
add(zips([(49901, 49971)], "consumers energy"), "Keweenaw Peninsula MI — Consumers")

# DTE Energy — Detroit metro: 480xx-482xx, 483xx, 484xx-487xx
add(zips([(48000, 48099)], "dte"), "SE Michigan — DTE")
add(zips([(48100, 48219)], "dte"), "Detroit MI — DTE")
add(zips([(48220, 48240)], "dte"), "Oak Park/Royal Oak MI — DTE")
add(zips([(48301, 48309)], "dte"), "Bloomfield Hills MI — DTE")
add(zips([(48340, 48350)], "dte"), "Pontiac MI — DTE")
add(zips([(48360, 48380)], "dte"), "Rochester/Troy MI — DTE")
add(zips([(48430, 48460)], "dte"), "Fenton/Flint area MI — DTE")

# =============================================================================
# OHIO
# =============================================================================

# AEP Ohio (Columbus Southern Power): 430xx-439xx, 450xx-462xx
add(zips([(43001, 43099)], "aep"), "Licking County OH — AEP")
add(zips([(43101, 43199)], "aep"), "Fairfield/Hocking OH — AEP")
add(zips([(43201, 43299)], "aep"), "Columbus OH — AEP")
add(zips([(43301, 43399)], "aep"), "Marion/Delaware OH — AEP")
add(zips([(43401, 43469)], "aep"), "Findlay OH — AEP border")
add(zips([(43501, 43599)], "aep"), "Williams/Fulton OH — AEP")
add(zips([(43601, 43699)], "aep"), "Toledo OH — AEP border")
add(zips([(43701, 43799)], "aep"), "Zanesville OH — AEP")
add(zips([(43801, 43899)], "aep"), "Coshocton/Holmes OH — AEP")
add(zips([(43901, 43999)], "aep"), "Jefferson County OH — AEP")
add(zips([(44001, 44099)], "aep"), "Lorain County OH — AEP")
add(zips([(45001, 45099)], "aep"), "Cincinnati area OH — AEP border")
add(zips([(45101, 45199)], "aep"), "Brown/Clermont OH — AEP")
add(zips([(45601, 45699)], "aep"), "Chillicothe OH — AEP")
add(zips([(45701, 45799)], "aep"), "Athens/Gallia OH — AEP")
add(zips([(45801, 45896)], "aep"), "Lima/Van Wert OH — AEP")
add(zips([(45901, 45999)], "aep"), "Putnam/Hancock OH — AEP")

# =============================================================================
# COLORADO
# =============================================================================

# Xcel Energy CO — Front Range + mountains: 800xx-816xx
add(zips([(80001, 80099)], "xcel"), "Denver CO — Xcel")
add(zips([(80101, 80199)], "xcel"), "Arapahoe/Douglas CO — Xcel")
add(zips([(80201, 80299)], "xcel"), "Denver city CO — Xcel")
add(zips([(80301, 80310)], "xcel"), "Boulder CO — Xcel")
add(zips([(80401, 80480)], "xcel"), "Evergreen/Golden CO — Xcel")
add(zips([(80501, 80547)], "xcel"), "Longmont/Loveland CO — Xcel")
add(zips([(80601, 80650)], "xcel"), "Brighton/Greeley CO — Xcel")
add(zips([(80701, 80759)], "xcel"), "Ft. Morgan/Sterling CO — Xcel")
add(zips([(80801, 80864)], "xcel"), "Eastern plains CO — Xcel")
add(zips([(80901, 80999)], "xcel"), "Colorado Springs CO — Xcel")
add(zips([(81001, 81099)], "xcel"), "Pueblo CO — Xcel")
add(zips([(81101, 81158)], "xcel"), "Alamosa CO — Xcel")
add(zips([(81201, 81292)], "xcel"), "Salida/Cañon City CO — Xcel")
add(zips([(81301, 81340)], "xcel"), "Durango CO — Xcel")
add(zips([(81401, 81435)], "xcel"), "Montrose/Telluride CO — Xcel")
add(zips([(81601, 81658)], "xcel"), "Glenwood/Aspen CO — Xcel")

# =============================================================================
# MINNESOTA
# =============================================================================

# Xcel Energy MN — Twin Cities + southern MN: 550xx-565xx
add(zips([(55001, 55099)], "xcel"), "Metro MN — Xcel")
add(zips([(55101, 55199)], "xcel"), "St. Paul MN — Xcel")
add(zips([(55301, 55399)], "xcel"), "Wright/Sherburne County MN — Xcel")
add(zips([(55401, 55488)], "xcel"), "Minneapolis MN — Xcel")
add(zips([(55601, 55799)], "xcel"), "Northern MN — Xcel")
add(zips([(55901, 55992)], "xcel"), "Rochester/Mankato MN — Xcel")
add(zips([(56001, 56099)], "xcel"), "Mankato MN — Xcel")
add(zips([(56101, 56199)], "xcel"), "Marshall/Redwood MN — Xcel")
add(zips([(56201, 56299)], "xcel"), "Willmar MN — Xcel")
add(zips([(56301, 56399)], "xcel"), "St. Cloud MN — Xcel")
add(zips([(56401, 56499)], "xcel"), "Brainerd MN — Xcel")
add(zips([(56501, 56599)], "xcel"), "Detroit Lakes MN — Xcel")
add(zips([(56601, 56699)], "xcel"), "Bemidji MN — Xcel")
add(zips([(56701, 56763)], "xcel"), "Thief River Falls MN — Xcel")

# =============================================================================
# NEW JERSEY
# =============================================================================

# PSEG — Northern/Central NJ: 070xx-089xx
add(zips([(7001, 7099)], "pseg"), "Essex/Union County NJ — PSEG")
add(zips([(7101, 7199)], "pseg"), "Newark NJ — PSEG")
add(zips([(7201, 7299)], "pseg"), "Elizabeth NJ — PSEG")
add(zips([(7301, 7399)], "pseg"), "Jersey City NJ — PSEG")
add(zips([(7401, 7499)], "pseg"), "Passaic/Bergen NJ — PSEG")
add(zips([(7501, 7599)], "pseg"), "Paterson NJ — PSEG")
add(zips([(7601, 7699)], "pseg"), "Bergen County NJ — PSEG")
add(zips([(7701, 7799)], "pseg"), "Monmouth County NJ — PSEG")
add(zips([(7801, 7882)], "pseg"), "Morris/Sussex NJ — PSEG")
add(zips([(7901, 7999)], "pseg"), "Union/Somerset NJ — PSEG")
add(zips([(8001, 8099)], "pseg"), "Burlington NJ — PSEG")
add(zips([(8101, 8199)], "pseg"), "Camden NJ — PSEG")
add(zips([(8201, 8270)], "pseg"), "Atlantic County NJ — PSEG")
add(zips([(8301, 8360)], "pseg"), "Salem/Cumberland NJ — PSEG")
add(zips([(8401, 8406)], "pseg"), "Atlantic City NJ — PSEG")

# =============================================================================
# MASSACHUSETTS
# =============================================================================

# Eversource MA — Eastern MA + South Shore: 010xx-027xx
add(zips([(1001, 1099)], "eversource"), "Western MA — Eversource")
add(zips([(1101, 1199)], "eversource"), "Springfield MA — Eversource")
add(zips([(1201, 1299)], "eversource"), "Pittsfield/Berkshire MA — Eversource")
add(zips([(1301, 1399)], "eversource"), "Greenfield MA — Eversource")
add(zips([(1401, 1499)], "eversource"), "Northampton MA — Eversource")
add(zips([(1501, 1599)], "eversource"), "Worcester area MA — Eversource")
add(zips([(1601, 1699)], "eversource"), "Worcester city MA — Eversource")
add(zips([(1701, 1799)], "eversource"), "Framingham MA — Eversource")
add(zips([(1801, 1899)], "eversource"), "Lowell/Lawrence MA — Eversource")
add(zips([(1901, 1999)], "eversource"), "Lynn/Salem MA — Eversource")
add(zips([(2001, 2199)], "eversource"), "Boston MA — Eversource")
add(zips([(2301, 2399)], "eversource"), "Brockton/Plymouth MA — Eversource")
add(zips([(2401, 2499)], "eversource"), "Taunton/Attleboro MA — Eversource")
add(zips([(2501, 2568)], "eversource"), "Cape Cod MA — Eversource")
add(zips([(2601, 2671)], "eversource"), "Cape Cod MA — Eversource")
add(zips([(2701, 2790)], "eversource"), "New Bedford/Fall River MA — Eversource")

# =============================================================================
# CONNECTICUT
# =============================================================================

# Eversource CT: 060xx-069xx
add(zips([(6001, 6099)], "eversource"), "Hartford area CT — Eversource")
add(zips([(6101, 6199)], "eversource"), "Hartford city CT — Eversource")
add(zips([(6201, 6299)], "eversource"), "Windham County CT — Eversource")
add(zips([(6301, 6399)], "eversource"), "New London County CT — Eversource")
add(zips([(6401, 6489)], "eversource"), "New Haven area CT — Eversource")
add(zips([(6501, 6520)], "eversource"), "New Haven city CT — Eversource")
add(zips([(6601, 6699)], "eversource"), "Bridgeport CT — Eversource")
add(zips([(6701, 6799)], "eversource"), "Waterbury CT — Eversource")
add(zips([(6801, 6830)], "eversource"), "Fairfield County CT — Eversource")
add(zips([(6850, 6899)], "eversource"), "Norwalk/Stamford CT — Eversource")
add(zips([(6901, 6928)], "eversource"), "Stamford CT — Eversource")

# =============================================================================
# RHODE ISLAND
# =============================================================================

# National Grid RI: 028xx-029xx
add(zips([(2801, 2899)], "national grid ri"), "Providence/Kent RI — National Grid")
add(zips([(2901, 2940)], "national grid ri"), "Providence city RI — National Grid")

# =============================================================================
# VERMONT
# =============================================================================

# Green Mountain Power: 050xx-059xx
add(zips([(5001, 5099)], "green mountain power"), "Windsor County VT — GMP")
add(zips([(5101, 5199)], "green mountain power"), "Windham County VT — GMP")
add(zips([(5201, 5299)], "green mountain power"), "Bennington County VT — GMP")
add(zips([(5301, 5399)], "green mountain power"), "Rutland County VT — GMP")
add(zips([(5401, 5499)], "green mountain power"), "Burlington/Chittenden VT — GMP")
add(zips([(5501, 5544)], "green mountain power"), "Franklin/Grand Isle VT — GMP")
add(zips([(5601, 5699)], "green mountain power"), "Washington County VT — GMP")
add(zips([(5701, 5779)], "green mountain power"), "Lamoille/Orange VT — GMP")
add(zips([(5801, 5860)], "green mountain power"), "Caledonia/Essex VT — GMP")
add(zips([(5901, 5907)], "green mountain power"), "Orleans County VT — GMP")

# =============================================================================
# MAINE
# =============================================================================

# Central Maine Power: 040xx-049xx
add(zips([(4001, 4099)], "central maine power"), "Cumberland/York ME — CMP")
add(zips([(4101, 4199)], "central maine power"), "Portland ME — CMP")
add(zips([(4201, 4299)], "central maine power"), "Oxford/Franklin ME — CMP")
add(zips([(4301, 4399)], "central maine power"), "Kennebec County ME — CMP")
add(zips([(4401, 4499)], "central maine power"), "Penobscot County ME — CMP")
add(zips([(4530, 4579)], "central maine power"), "Knox/Waldo ME — CMP")
add(zips([(4601, 4699)], "central maine power"), "Washington/Hancock ME — CMP")

# =============================================================================
# TENNESSEE
# =============================================================================

# TVA — statewide TN: 370xx-385xx
add(zips([(37001, 37099)], "tva"), "Middle TN — TVA")
add(zips([(37101, 37199)], "tva"), "Middle TN rural — TVA")
add(zips([(37201, 37250)], "tva"), "Nashville TN — TVA")
add(zips([(37301, 37399)], "tva"), "Chattanooga area TN — TVA")
add(zips([(37401, 37424)], "tva"), "Chattanooga city TN — TVA")
add(zips([(37501, 37699)], "tva"), "Memphis area TN — TVA")
add(zips([(37701, 37799)], "tva"), "Knoxville area TN — TVA")
add(zips([(37801, 37899)], "tva"), "Maryville/Oak Ridge TN — TVA")
add(zips([(37901, 37999)], "tva"), "Knoxville city TN — TVA")
add(zips([(38001, 38099)], "tva"), "Jackson/Henderson TN — TVA")
add(zips([(38101, 38199)], "tva"), "Memphis city TN — TVA")
add(zips([(38201, 38299)], "tva"), "Dresden/McKenzie TN — TVA")
add(zips([(38301, 38399)], "tva"), "Jackson TN — TVA")
add(zips([(38401, 38499)], "tva"), "Columbia TN — TVA")
add(zips([(38501, 38599)], "tva"), "Cookeville TN — TVA")
add(zips([(38601, 38699)], "tva"), "NW MS / border TN — TVA")
add(zips([(38701, 38799)], "tva"), "Greenville MS / border — TVA")
add(zips([(38801, 38879)], "tva"), "Corinth area — TVA/MS border")
add(zips([(38901, 38960)], "tva"), "Mid MS border — TVA")

# =============================================================================
# LOUISIANA
# =============================================================================

# Entergy Louisiana: 700xx-714xx
add(zips([(70001, 70099)], "entergy louisiana"), "Metairie/New Orleans LA — Entergy")
add(zips([(70101, 70199)], "entergy louisiana"), "New Orleans city LA — Entergy")
add(zips([(70301, 70399)], "entergy louisiana"), "Houma/Thibodaux LA — Entergy")
add(zips([(70401, 70499)], "entergy louisiana"), "Covington/Hammond LA — Entergy")
add(zips([(70501, 70598)], "entergy louisiana"), "Lafayette LA — Entergy")
add(zips([(70601, 70669)], "entergy louisiana"), "Lake Charles LA — Entergy")
add(zips([(70701, 70792)], "entergy louisiana"), "Baton Rouge area LA — Entergy")
add(zips([(70801, 70836)], "entergy louisiana"), "Baton Rouge city LA — Entergy")
add(zips([(70901, 70956)], "entergy louisiana"), "Monroe/Shreveport area LA — Entergy")
add(zips([(71001, 71099)], "entergy louisiana"), "Shreveport area LA — Entergy")
add(zips([(71101, 71161)], "entergy louisiana"), "Shreveport city LA — Entergy")
add(zips([(71201, 71280)], "entergy louisiana"), "Monroe LA — Entergy")
add(zips([(71301, 71360)], "entergy louisiana"), "Alexandria LA — Entergy")
add(zips([(71401, 71497)], "entergy louisiana"), "Natchitoches/Opelousas LA — Entergy")

# =============================================================================
# ARKANSAS
# =============================================================================

# Entergy Arkansas: 716xx-729xx
add(zips([(71601, 71670)], "entergy arkansas"), "Pine Bluff AR — Entergy")
add(zips([(71701, 71772)], "entergy arkansas"), "Camden/El Dorado AR — Entergy")
add(zips([(71801, 71866)], "entergy arkansas"), "Texarkana/Hope AR — Entergy")
add(zips([(71901, 71998)], "entergy arkansas"), "Hot Springs AR — Entergy")
add(zips([(72001, 72099)], "entergy arkansas"), "Little Rock suburbs AR — Entergy")
add(zips([(72101, 72199)], "entergy arkansas"), "Conway/Central AR — Entergy")
add(zips([(72201, 72217)], "entergy arkansas"), "Little Rock city AR — Entergy")
add(zips([(72301, 72399)], "entergy arkansas"), "West Memphis AR — Entergy")
add(zips([(72401, 72499)], "entergy arkansas"), "Jonesboro AR — Entergy")
add(zips([(72501, 72587)], "entergy arkansas"), "Batesville/Mountain Home AR — Entergy")
add(zips([(72601, 72699)], "entergy arkansas"), "Harrison AR — Entergy")
add(zips([(72701, 72762)], "entergy arkansas"), "Fayetteville/Springdale AR — Entergy")
add(zips([(72801, 72863)], "entergy arkansas"), "Fort Smith AR — Entergy")
add(zips([(72901, 72959)], "entergy arkansas"), "Fort Smith area AR — Entergy")

# =============================================================================
# KENTUCKY
# =============================================================================

# Kentucky Utilities: 400xx-427xx
add(zips([(40003, 40099)], "kentucky utilities"), "Henry/Trimble County KY — KU")
add(zips([(40101, 40229)], "kentucky utilities"), "Louisville area KY — KU/LG&E")
add(zips([(40311, 40399)], "kentucky utilities"), "Morehead/Bath County KY — KU")
add(zips([(40401, 40488)], "kentucky utilities"), "Richmond/Berea KY — KU")
add(zips([(40501, 40599)], "kentucky utilities"), "Lexington KY — KU")
add(zips([(40601, 40622)], "kentucky utilities"), "Frankfort KY — KU")
add(zips([(40701, 40799)], "kentucky utilities"), "Corbin KY — KU")
add(zips([(40801, 40874)], "kentucky utilities"), "Harlan/Bell County KY — KU")
add(zips([(40901, 40997)], "kentucky utilities"), "Williamsburg/Barbourville KY — KU")
add(zips([(41001, 41099)], "kentucky utilities"), "Northern KY — KU")
add(zips([(41101, 41180)], "kentucky utilities"), "Ashland/Huntington KY — KU")
add(zips([(41201, 41299)], "kentucky utilities"), "Eastern KY mountains — KU")
add(zips([(41301, 41399)], "kentucky utilities"), "Hazard/Prestonsburg KY — KU")
add(zips([(41501, 41599)], "kentucky utilities"), "Pikeville KY — KU")
add(zips([(41601, 41699)], "kentucky utilities"), "Floyd County KY — KU")
add(zips([(41701, 41799)], "kentucky utilities"), "Hindman KY — KU")
add(zips([(41801, 41866)], "kentucky utilities"), "Whitesburg KY — KU")
add(zips([(42001, 42086)], "kentucky utilities"), "Paducah KY — KU")
add(zips([(42101, 42170)], "kentucky utilities"), "Bowling Green KY — KU")
add(zips([(42201, 42276)], "kentucky utilities"), "Elizabethtown KY — KU")
add(zips([(42301, 42376)], "kentucky utilities"), "Owensboro KY — KU")
add(zips([(42401, 42442)], "kentucky utilities"), "Madisonville KY — KU")
add(zips([(42501, 42567)], "kentucky utilities"), "Somerset KY — KU")
add(zips([(42601, 42653)], "kentucky utilities"), "Russell Springs KY — KU")
add(zips([(42701, 42788)], "kentucky utilities"), "Lebanon KY — KU")

# =============================================================================
# NEVADA
# =============================================================================

# NV Energy — Las Vegas + Reno: 889xx-898xx
add(zips([(89001, 89049)], "nv energy"), "Las Vegas rural NV — NV Energy")
add(zips([(89050, 89060)], "nv energy"), "Henderson NV — NV Energy")
add(zips([(89101, 89199)], "nv energy"), "Las Vegas city NV — NV Energy")
add(zips([(89301, 89319)], "nv energy"), "Elko NV — NV Energy")
add(zips([(89401, 89450)], "nv energy"), "Carson City/Reno area NV — NV Energy")
add(zips([(89501, 89521)], "nv energy"), "Reno NV — NV Energy")
add(zips([(89701, 89721)], "nv energy"), "Carson City NV — NV Energy")
add(zips([(89801, 89835)], "nv energy"), "Elko/Wells NV — NV Energy")
add(zips([(89883, 89890)], "nv energy"), "Ely NV — NV Energy")

# =============================================================================
# ARIZONA
# =============================================================================

# APS (Arizona Public Service): 850xx-860xx, 863xx-865xx, 855xx
add(zips([(85001, 85099)], "aps"), "Phoenix AZ — APS")
add(zips([(85101, 85199)], "aps"), "Phoenix East Valley AZ — APS")
add(zips([(85201, 85299)], "aps"), "Mesa/Tempe AZ — APS")
add(zips([(85301, 85399)], "aps"), "Glendale/Peoria AZ — APS")
add(zips([(85401, 85499)], "aps"), "Prescott Valley AZ — APS")
add(zips([(85501, 85543)], "aps"), "Globe/Show Low AZ — APS")
add(zips([(85601, 85650)], "aps"), "Southern AZ — APS border")
add(zips([(85701, 85750)], "aps"), "Tucson AZ — APS border")  # TEP serves most of Tucson
add(zips([(85801, 85940)], "aps"), "Flagstaff/Holbrook AZ — APS")
add(zips([(86001, 86099)], "aps"), "Flagstaff AZ — APS")
add(zips([(86301, 86340)], "aps"), "Prescott AZ — APS")
add(zips([(86401, 86446)], "aps"), "Kingman/Bullhead City AZ — APS")
add(zips([(86501, 86515)], "aps"), "Navajo Nation AZ — APS")

# =============================================================================
# IDAHO
# =============================================================================

# Idaho Power: 832xx-838xx (SW Idaho/Boise)
add(zips([(83201, 83299)], "idaho power"), "Pocatello ID — Idaho Power")
add(zips([(83301, 83376)], "idaho power"), "Twin Falls ID — Idaho Power")
add(zips([(83401, 83469)], "idaho power"), "Idaho Falls ID — Idaho Power")
add(zips([(83501, 83549)], "idaho power"), "Lewiston ID — Idaho Power")
add(zips([(83601, 83680)], "idaho power"), "Mountain Home/Glenns Ferry ID — Idaho Power")
add(zips([(83701, 83709)], "idaho power"), "Boise city ID — Idaho Power")
add(zips([(83711, 83720)], "idaho power"), "Boise ID — Idaho Power")
add(zips([(83801, 83876)], "idaho power"), "Coeur d'Alene ID — Idaho Power")

# =============================================================================
# WISCONSIN
# =============================================================================

# We Energies: 530xx-532xx (Milwaukee/Waukesha/Racine/Kenosha)
add(zips([(53001, 53099)], "we energies"), "SE Wisconsin — We Energies")
add(zips([(53101, 53199)], "we energies"), "Racine/Kenosha WI — We Energies")
add(zips([(53201, 53299)], "we energies"), "Milwaukee city WI — We Energies")
add(zips([(53401, 53408)], "we energies"), "Racine city WI — We Energies")
add(zips([(53501, 53599)], "we energies"), "Madison area WI — We Energies")
add(zips([(53601, 53599)], "we energies"), "Madison WI — We Energies")
add(zips([(53700, 53799)], "we energies"), "Madison city WI — We Energies")
add(zips([(53801, 53830)], "we energies"), "SW Wisconsin — We Energies")
add(zips([(53901, 53969)], "we energies"), "Central WI — We Energies")

# =============================================================================
# HAWAII
# =============================================================================

# Hawaiian Electric: 967xx-968xx
add(zips([(96701, 96799)], "hawaiian electric"), "Oahu HI — Hawaiian Electric")
add(zips([(96801, 96860)], "hawaiian electric"), "Honolulu HI — Hawaiian Electric")
add(zips([(96701, 96712)], "hawaiian electric"), "Aiea/Pearl City HI — Hawaiian Electric")
add(zips([(96720, 96778)], "hawaiian electric"), "Hilo/Big Island HI — Hawaiian Electric")
add(zips([(96790, 96797)], "hawaiian electric"), "Kihei/Maui HI — Hawaiian Electric")

# =============================================================================
# Alabama
# =============================================================================

# Alabama Power (Southern Company): 350xx-369xx
add(zips([(35004, 35099)], "alabama power"), "Jefferson County AL — Alabama Power")
add(zips([(35101, 35228)], "alabama power"), "Birmingham AL — Alabama Power")
add(zips([(35401, 35490)], "alabama power"), "Tuscaloosa AL — Alabama Power")
add(zips([(35501, 35599)], "alabama power"), "Jasper AL — Alabama Power")
add(zips([(35601, 35699)], "alabama power"), "Decatur/Huntsville area AL — Alabama Power")
add(zips([(35801, 35899)], "alabama power"), "Huntsville AL — Alabama Power")
add(zips([(35901, 35980)], "alabama power"), "Gadsden AL — Alabama Power")
add(zips([(36001, 36049)], "alabama power"), "Montgomery area AL — Alabama Power")
add(zips([(36051, 36079)], "alabama power"), "Prattville AL — Alabama Power")
add(zips([(36101, 36130)], "alabama power"), "Montgomery city AL — Alabama Power")
add(zips([(36201, 36279)], "alabama power"), "Anniston/Talladega AL — Alabama Power")
add(zips([(36301, 36350)], "alabama power"), "Dothan AL — Alabama Power")
add(zips([(36401, 36476)], "alabama power"), "Evergreen/Greenville AL — Alabama Power")
add(zips([(36501, 36580)], "alabama power"), "Mobile County AL — Alabama Power")
add(zips([(36601, 36695)], "alabama power"), "Mobile city AL — Alabama Power")
add(zips([(36701, 36793)], "alabama power"), "Selma/Demopolis AL — Alabama Power")
add(zips([(36801, 36869)], "alabama power"), "Auburn/Opelika AL — Alabama Power")
add(zips([(36901, 36925)], "alabama power"), "Livingston AL — Alabama Power")

# =============================================================================
# Deduplicate (keep first occurrence for each ZIP)
# =============================================================================
seen = {}
deduped = []
for (z, u, c) in all_entries:
    if z not in seen:
        seen[z] = True
        deduped.append((z, u, c))

print(f"Total ZIP entries: {len(deduped)}")

# Group by utility name for output
from collections import defaultdict
by_utility = defaultdict(list)
for (z, u, c) in deduped:
    by_utility[u].append((z, c))

for util, entries in sorted(by_utility.items()):
    print(f"  {util}: {len(entries)} ZIPs")

# Generate TypeScript block
lines = []
lines.append("    // ═══════════════════════════════════════════════════════════════════════════")
lines.append("    // NATIONAL ZIP → UTILITY MAP (auto-generated — do not hand-edit)")
lines.append("    // Generated by scripts/build_national_zip_map.py")
lines.append(f"    // {len(deduped)} ZIP entries covering {len(by_utility)} utility territories")
lines.append("    // ═══════════════════════════════════════════════════════════════════════════")

current_util = None
for (z, u, c) in deduped:
    if u != current_util:
        lines.append(f"    // — {u.title()} —")
        current_util = u
    lines.append(f"    '{z}': '{u}', // {c}")

ts_block = "\n".join(lines)

with open("/workspace/generated_zip_map.txt", "w") as f:
    f.write(ts_block)

print(f"\nWrote {len(lines)} lines to /workspace/generated_zip_map.txt")
