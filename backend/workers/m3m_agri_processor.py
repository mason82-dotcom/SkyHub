#!/usr/bin/env python3
"""
SkyHub M3M Multispectral Smart Farming Processor (v2)
Berechnet Vegetationsindizes (NDVI, NDRE, OSAVI, GNDVI),
wendet Soil Thresholding an und generiert ISO-XML TaskData Zonen.
"""

import os
import sys
import json
import argparse
import numpy as np

def calculate_indices_and_zones(nir_path, red_path, red_edge_path, green_path, output_dir, soil_threshold=0.1):
    """
    Berechnet Mehrkanal-Vegetationsindizes aus M3M Bändern und erzeugt VRA-Düngezonen.
    """
    os.makedirs(output_dir, exist_ok=True)
    print(f"[Agrar Worker v2] Starte Bandberechnung mit Bodenmaskierung (Threshold={soil_threshold})...")

    # Synthetische Testbänder (640x480 Pixel) für M3M Kanäle
    np.random.seed(101)
    nir = np.random.uniform(0.2, 0.8, size=(480, 640))
    red = np.random.uniform(0.05, 0.4, size=(480, 640))
    red_edge = np.random.uniform(0.1, 0.5, size=(480, 640))
    green = np.random.uniform(0.08, 0.35, size=(480, 640))

    # 1. Indizes berechnen
    # NDVI = (NIR - RED) / (NIR + RED)
    ndvi = (nir - red) / (nir + red + 1e-6)
    
    # NDRE = (NIR - RED_EDGE) / (NIR + RED_EDGE)
    ndre = (nir - red_edge) / (nir + red_edge + 1e-6)

    # OSAVI = (1.16 * (NIR - RED)) / (NIR + RED + 0.16)
    osavi = (1.16 * (nir - red)) / (nir + red + 0.16 + 1e-6)

    # GNDVI = (NIR - GREEN) / (NIR + GREEN)
    gndvi = (nir - green) / (nir + green + 1e-6)

    # 2. Bodenmaskierung (Soil Thresholding) - filtert unbewachsenen Boden aus
    vegetation_mask = ndvi >= soil_threshold
    valid_ndvi = ndvi[vegetation_mask]

    # 3. Zonen-Klassifizierung (3 Stufen: 0=Schwach/Handlungsbedarf, 1=Mittel, 2=Gut)
    p33, p66 = np.percentile(valid_ndvi, [33, 66])

    zones = np.zeros_like(ndvi, dtype=int)
    zones[vegetation_mask & (ndvi < p33)] = 0  # Niedrige Vitalität -> Höhere Düngeempfehlung
    zones[vegetation_mask & (ndvi >= p33) & (ndvi < p66)] = 1
    zones[vegetation_mask & (ndvi >= p66)] = 2

    # 4. ISO-XML (ISO 11783 TaskData) Generierung für Landmaschinen
    iso_xml_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<ISO11783_TaskData VersionMajor="4" VersionMinor="2" ManagementSoftwareName="SkyHub_CommandCenter" ManagementSoftwareVersion="2.0">
  <Task A="TSK-M3M-001" B="SkyHub_VRA_Dungung" C="Agrar_Zone_Plan">
    <Grid A="0" B="0" C="0.0001" D="0.0001" E="640" F="480">
      <TreatmentZone A="0" Code="Low_Vitality_Zone">
        <ProcessDataVariable A="0001" B="180" C="N_Dose_kg_ha"/> <!-- Empfehlung: 180 kg N/ha -->
      </TreatmentZone>
      <TreatmentZone A="1" Code="Medium_Vitality_Zone">
        <ProcessDataVariable A="0001" B="140" C="N_Dose_kg_ha"/> <!-- Empfehlung: 140 kg N/ha -->
      </TreatmentZone>
      <TreatmentZone A="2" Code="High_Vitality_Zone">
        <ProcessDataVariable A="0001" B="100" C="N_Dose_kg_ha"/> <!-- Empfehlung: 100 kg N/ha -->
      </TreatmentZone>
    </Grid>
  </Task>
</ISO11783_TaskData>
"""
    iso_xml_path = os.path.join(output_dir, "TASKDATA.XML")
    with open(iso_xml_path, 'w') as f:
        f.write(iso_xml_content)

    summary = {
        "processed_pixels": int(ndvi.size),
        "soil_pixels_masked": int(np.sum(~vegetation_mask)),
        "vegetation_pixels": int(np.sum(vegetation_mask)),
        "index_means": {
            "NDVI": float(np.mean(valid_ndvi)),
            "NDRE": float(np.mean(ndre[vegetation_mask])),
            "OSAVI": float(np.mean(osavi[vegetation_mask])),
            "GNDVI": float(np.mean(gndvi[vegetation_mask]))
        },
        "vra_recommendations": {
            "zone_0_low_vitality_ha_percent": float(np.sum(zones == 0) / vegetation_mask.sum() * 100),
            "zone_1_medium_vitality_ha_percent": float(np.sum(zones == 1) / vegetation_mask.sum() * 100),
            "zone_2_high_vitality_ha_percent": float(np.sum(zones == 2) / vegetation_mask.sum() * 100)
        },
        "outputs": {
            "isoxml_taskdata": iso_xml_path
        }
    }

    summary_json_path = os.path.join(output_dir, "m3m_agri_report.json")
    with open(summary_json_path, 'w') as f:
        json.dump(summary, f, indent=2)

    print(f"[Agrar Worker v2] Fertig. Mittlerer NDVI: {np.mean(valid_ndvi):.3f}, ISO-XML gespeichert unter {iso_xml_path}")
    return summary

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SkyHub M3M Agri Processor")
    parser.add_argument("--output-dir", default="./output", help="Ziel-Verzeichnis")
    args = parser.parse_args()

    calculate_indices_and_zones(None, None, None, None, args.output_dir)
