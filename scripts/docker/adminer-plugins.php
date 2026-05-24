<?php
function adminer_object() {
    class AdminerPermanentLogin extends Adminer {
        function permanentLogin($create = false) {
            return "f3-local-dev-key";
        }
        function name() {
            return "F3 Nation DB";
        }
    }
    return new AdminerPermanentLogin;
}
include './adminer.php';
