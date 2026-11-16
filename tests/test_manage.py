import io
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from mac_traffic_ledger import manage


class ManageTests(unittest.TestCase):
    def test_stop_failure_does_not_report_success_or_remove_configuration(self):
        def run(args, *, check, **_):
            result = subprocess.CompletedProcess(args, 5 if args[1] == "bootout" else 0)
            if check:
                result.check_returncode()
            return result

        with tempfile.TemporaryDirectory() as directory:
            plist = Path(directory) / "test.plist"
            plist.touch()
            for command in ("stop", "uninstall"):
                with (
                    self.subTest(command=command),
                    patch.object(manage, "PLIST", plist),
                    patch.object(manage.sys, "argv", ["manage", command]),
                    patch.object(manage.subprocess, "run", side_effect=run),
                    redirect_stdout(io.StringIO()) as output,
                ):
                    with self.assertRaises(SystemExit) as error:
                        manage.main()
                    self.assertEqual(error.exception.code, 5)
                    self.assertNotIn("Stopped", output.getvalue())
                    self.assertTrue(plist.exists())
