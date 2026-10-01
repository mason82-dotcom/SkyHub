import io
import unittest
import zipfile

from app.dji.wpml import WpmlError, read_wpml_kmz


TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
<Document>
<wpml:missionConfig>
<wpml:droneInfo><wpml:droneEnumValue>77</wpml:droneEnumValue><wpml:droneSubEnumValue>2</wpml:droneSubEnumValue></wpml:droneInfo>
<wpml:payloadInfo><wpml:payloadEnumValue>68</wpml:payloadEnumValue><wpml:payloadPositionIndex>0</wpml:payloadPositionIndex></wpml:payloadInfo>
</wpml:missionConfig>
<Folder><wpml:templateType>waypoint</wpml:templateType><wpml:templateId>0</wpml:templateId></Folder>
</Document></kml>
"""

WAYLINES = """<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
<Document>
<wpml:missionConfig>
<wpml:droneInfo><wpml:droneEnumValue>77</wpml:droneEnumValue><wpml:droneSubEnumValue>2</wpml:droneSubEnumValue></wpml:droneInfo>
<wpml:payloadInfo><wpml:payloadEnumValue>68</wpml:payloadEnumValue><wpml:payloadPositionIndex>0</wpml:payloadPositionIndex></wpml:payloadInfo>
</wpml:missionConfig>
<Folder><wpml:templateId>0</wpml:templateId><wpml:executeHeightMode>WGS84</wpml:executeHeightMode><wpml:waylineId>0</wpml:waylineId></Folder>
</Document></kml>
"""


def kmz(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in entries:
            zf.writestr(name, content)
    return out.getvalue()


class WpmlTests(unittest.TestCase):
    def test_reads_m3m_metadata_and_resources(self):
        parsed = read_wpml_kmz(kmz([
            ("wpmz/template.kml", TEMPLATE),
            ("wpmz/waylines.wpml", WAYLINES),
            ("wpmz/res/reference.txt", "x"),
        ]))
        self.assertEqual(parsed["metadata"]["drone_model_key"], "0-77-2")
        self.assertEqual(parsed["metadata"]["payload_model_keys"], ["1-68-0"])
        self.assertEqual(parsed["metadata"]["template_types"], [0])
        self.assertEqual(parsed["resources"], ["wpmz/res/reference.txt"])

    def test_requires_exact_paths(self):
        with self.assertRaises(WpmlError):
            read_wpml_kmz(kmz([
                ("template.kml", TEMPLATE),
                ("waylines.wpml", WAYLINES),
            ]))

    def test_rejects_parent_directory_entry(self):
        with self.assertRaises(WpmlError):
            read_wpml_kmz(kmz([
                ("wpmz/template.kml", TEMPLATE),
                ("wpmz/waylines.wpml", WAYLINES),
                ("wpmz/../evil.txt", "x"),
            ]))

    def test_rejects_duplicate_path(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as zf:
            zf.writestr("wpmz/template.kml", TEMPLATE)
            zf.writestr("wpmz/template.kml", TEMPLATE)
            zf.writestr("wpmz/waylines.wpml", WAYLINES)
        with self.assertRaises(WpmlError):
            read_wpml_kmz(out.getvalue())

    def test_rejects_dtd(self):
        evil = '<!DOCTYPE kml><kml xmlns:wpml="http://www.dji.com/wpmz/1.0.2"></kml>'
        with self.assertRaises(WpmlError):
            read_wpml_kmz(kmz([
                ("wpmz/template.kml", evil),
                ("wpmz/waylines.wpml", WAYLINES),
            ]))


if __name__ == "__main__":
    unittest.main()
